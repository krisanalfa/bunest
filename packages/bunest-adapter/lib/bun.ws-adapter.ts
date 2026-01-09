import {
  AbstractWsAdapter,
  BaseWsInstance,
  MessageMappingProperties,
} from '@nestjs/websockets'
import { EMPTY, Observable, Subject, Subscription, mergeMap } from 'rxjs'
import { INestApplicationContext, Logger } from '@nestjs/common'
import { NestApplication } from '@nestjs/core'
import { ServerWebSocket } from 'bun'
import { isNil } from '@nestjs/common/utils/shared.utils.js'

import { BunWsClientData, WsData, WsOptions } from './bun.internal.types.js'
import { BunServerInstance } from './bun.server-instance.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type WsMessageParser<TData = unknown> = (data: WsData) => WsParsedData<TData>

export interface WsParsedData<TData = unknown> {
  event: string
  data: TData
}

export interface BunWsAdapterOptions extends WsOptions {
  messageParser?: WsMessageParser
}

type BunWsClient = ServerWebSocket<BunWsClientData> & BaseWsInstance

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** WebSocket ready state for OPEN */
const WS_READY_STATE_OPEN = 1

// ─────────────────────────────────────────────────────────────────────────────
// Default Message Parser
// ─────────────────────────────────────────────────────────────────────────────

const defaultMessageParser: WsMessageParser = (data: WsData): WsParsedData => {
  if (typeof data === 'string') {
    return JSON.parse(data) as WsParsedData
  }
  if (data instanceof ArrayBuffer) {
    return JSON.parse(new TextDecoder().decode(data)) as WsParsedData
  }
  if (Buffer.isBuffer(data)) {
    return JSON.parse(data.toString('utf8')) as WsParsedData
  }
  // Buffer[] - concatenate and parse
  return JSON.parse(Buffer.concat(data).toString('utf8')) as WsParsedData
}

// ─────────────────────────────────────────────────────────────────────────────
// BunWsAdapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * High-performance WebSocket adapter for Bun runtime with NestJS.
 */
export class BunWsAdapter extends AbstractWsAdapter<BunServerInstance, BunWsClient> {
  private readonly logger = new Logger(BunWsAdapter.name)
  private readonly nestApp: NestApplication

  private messageParser: WsMessageParser = defaultMessageParser
  private onOpenHandler?: (ws: ServerWebSocket<unknown>) => void
  private globalHandlersInitialized = false

  constructor(appOrHttpServer?: INestApplicationContext | object) {
    super(appOrHttpServer)

    if (!appOrHttpServer || !('getHttpAdapter' in appOrHttpServer)) {
      throw new Error('BunWsAdapter requires a NestApplication instance in the constructor.')
    }

    this.nestApp = appOrHttpServer as NestApplication
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Server Lifecycle
  // ───────────────────────────────────────────────────────────────────────────

  create(_port: number, options?: BunWsAdapterOptions): BunServerInstance {
    if (options?.messageParser) {
      this.messageParser = options.messageParser
    }

    const server = this.nestApp.getHttpAdapter().getHttpServer() as BunServerInstance
    const wsOptions = this.extractWsOptions(options)

    server.setWsOptions(wsOptions)
    this.initializeGlobalHandlers(server)

    return server
  }

  private extractWsOptions(options?: BunWsAdapterOptions): WsOptions {
    if (!options) {
      return {}
    }
    const wsOptions: WsOptions = { ...options }
    delete (wsOptions as { messageParser?: unknown }).messageParser
    return wsOptions
  }

  override async close(server: BunServerInstance): Promise<void> {
    await server.close()
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Client Binding
  // ───────────────────────────────────────────────────────────────────────────

  override bindClientConnect(server: BunServerInstance, callback: (client: BunWsClient) => void): void {
    this.onOpenHandler = callback as (ws: ServerWebSocket<unknown>) => void
  }

  override bindClientDisconnect(client: BunWsClient, callback: (client: BunWsClient) => void): void {
    const existingHandler = client.data.onDisconnect
    client.data.onDisconnect = (ws) => {
      existingHandler?.(ws)
      callback(client)
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Message Handling
  // ───────────────────────────────────────────────────────────────────────────

  bindMessageHandlers(
    client: BunWsClient,
    handlers: MessageMappingProperties[],
    transform: (data: unknown) => Observable<unknown>,
  ): void {
    // Build handler lookup map once per client (avoids repeated array iteration)
    const handlerMap = this.buildHandlerMap(handlers)

    // Use Subject for efficient push-based message handling
    const message$ = new Subject<WsData>()
    let isActive = true

    // Wire up message handler - using onMessageInternal to match bun.adapter.ts
    const existingOnMessage = client.data.onMessageInternal
    client.data.onMessageInternal = (data) => {
      existingOnMessage?.(data)
      if (isActive) {
        message$.next(data)
      }
    }

    // Process messages through handler pipeline
    const subscription = message$
      .pipe(
        mergeMap(data => this.processMessage(data, handlerMap, transform)),
      )
      .subscribe({
        next: (response) => {
          this.sendResponse(client, response, isActive)
        },
        error: (err) => {
          this.logger.error('Message processing error', err instanceof Error ? err.stack : err)
        },
      })

    // Wire up close handler for cleanup - using onCloseInternal to match bun.adapter.ts
    const existingOnClose = client.data.onCloseInternal
    client.data.onCloseInternal = () => {
      existingOnClose?.()
      isActive = false
      this.cleanupClient(message$, subscription)
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ───────────────────────────────────────────────────────────────────────────

  private initializeGlobalHandlers(server: BunServerInstance): void {
    if (this.globalHandlersInitialized) {
      return
    }
    this.globalHandlersInitialized = true

    // Open handler - delegates to NestJS gateway's handleConnection
    server.registerWsOpenHandler((ws) => {
      this.onOpenHandler?.(ws)
    })

    // Message and close are handled via client.data callbacks set by bun.adapter.ts
    // Register empty handlers to satisfy the server interface
    server.registerWsMessageHandler(() => {
      // Handled via client.data.onMessage
    })
    server.registerWsCloseHandler(() => {
      // Handled via client.data.onClose
    })
  }

  private buildHandlerMap(handlers: MessageMappingProperties[]): Map<string, MessageMappingProperties> {
    const map = new Map<string, MessageMappingProperties>()
    for (const handler of handlers) {
      map.set(handler.message as string, handler)
    }
    return map
  }

  private processMessage(
    data: WsData,
    handlerMap: Map<string, MessageMappingProperties>,
    transform: (data: unknown) => Observable<unknown>,
  ): Observable<unknown> {
    try {
      const parsed = this.messageParser(data)

      // Validate message structure (event must be a string)
      if (typeof parsed.event !== 'string') {
        return EMPTY
      }

      const handler = handlerMap.get(parsed.event)
      if (!handler) {
        return EMPTY
      }

      const result = handler.callback(parsed.data, parsed.event)
      return transform(result).pipe(
        mergeMap(value => isNil(value) ? EMPTY : [value]),
      )
    }
    catch (error) {
      this.logger.warn(
        'Failed to parse WebSocket message',
        error instanceof Error ? error.message : String(error),
      )
      return EMPTY
    }
  }

  private sendResponse(client: BunWsClient, response: unknown, isActive: boolean): void {
    if (!isActive || client.readyState !== WS_READY_STATE_OPEN) {
      return
    }

    // Handle binary responses efficiently
    if (response instanceof ArrayBuffer) {
      client.send(response)
      return
    }

    if (ArrayBuffer.isView(response)) {
      client.send(response.buffer as ArrayBuffer)
      return
    }

    // JSON serialize other responses
    client.send(JSON.stringify(response))
  }

  private cleanupClient(
    message$: Subject<WsData>,
    subscription: Subscription,
  ): void {
    message$.complete()
    subscription.unsubscribe()
  }
}
