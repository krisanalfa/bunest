/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import { AbstractWsAdapter, BaseWsInstance, MessageMappingProperties } from '@nestjs/websockets'
import { EMPTY, Observable, filter, mergeMap, share, takeUntil } from 'rxjs'
import { INestApplicationContext, Logger } from '@nestjs/common'
import { NestApplication } from '@nestjs/core'
import { ServerWebSocket } from 'bun'
import { isNil } from '@nestjs/common/utils/shared.utils.js'

import { BunPreflightHttpServer } from './bun.preflight-http-server.js'
import { WsOptions } from './internal.types.js'

type WsData = string | Buffer | ArrayBuffer | Buffer[]
interface WsParsedData<TData> { event: string, data: TData }
type WsMessageParser = (data: WsData) => WsParsedData<unknown>
type WsMessageData = string | ArrayBuffer | Buffer | Buffer[]

export interface BunWsAdapterOptions extends WsOptions {
  messageParser?: WsMessageParser
}

interface BunWsData {
  onCloseInternal?: () => void
  onMessageInternal?: (message: WsMessageData) => void
  onDisconnect?: (ws: ServerWebSocket<unknown>) => void
}

export class BunWsAdapter extends AbstractWsAdapter<BunPreflightHttpServer, ServerWebSocket<BunWsData> & BaseWsInstance> {
  private readonly logger = new Logger('BunWsAdapter')
  protected messageParser: WsMessageParser = (data: WsData) => {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return JSON.parse(data.toString()) as WsParsedData<unknown>
  }

  // May need this later
  private readonly nestApp: INestApplicationContext

  // Track active connections using WeakMap to prevent memory leaks
  private readonly connectionCloseStreams = new WeakMap<ServerWebSocket<BunWsData>, Observable<void>>()

  // Shared handlers - set once, not per client
  private onOpenHandler?: (ws: ServerWebSocket<unknown>) => void
  private hasGlobalHandlersSetup = false

  constructor(appOrHttpServer?: INestApplicationContext | object) {
    super(appOrHttpServer)

    if (!appOrHttpServer) {
      throw new Error('BunWsAdapter requires a NestApplication instance in the constructor.')
    }

    if (appOrHttpServer instanceof NestApplication) {
      this.nestApp = appOrHttpServer
    }
    else {
      throw new Error('BunWsAdapter constructor argument must be an instance of NestApplication.')
    }
  }

  create(port: number, options?: BunWsAdapterOptions): BunPreflightHttpServer {
    const { messageParser, ...wsOptions } = options ?? {}
    if (messageParser) {
      this.messageParser = messageParser
    }

    const preflightHttpServer = this.httpServer as BunPreflightHttpServer
    preflightHttpServer.setWsOptions(wsOptions)

    // Set up global handlers once that delegate to all client handlers
    this.setupGlobalHandlers(preflightHttpServer)

    return preflightHttpServer
  }

  private setupGlobalHandlers(preflightHttpServer: BunPreflightHttpServer): void {
    if (this.hasGlobalHandlersSetup) {
      return
    }
    this.hasGlobalHandlersSetup = true

    // Register global open handler (called once per client)
    preflightHttpServer.registerWsOpenHandler((ws) => {
      this.onOpenHandler?.(ws)
    })

    // Register stubs for message and close - actual handling is done in bun.adapter.ts
    // via ws.data.onMessageInternal and ws.data.onCloseInternal
    preflightHttpServer.registerWsMessageHandler(() => {
      // No-op: handled by bun.adapter.ts calling ws.data.onMessageInternal
    })

    preflightHttpServer.registerWsCloseHandler(() => {
      // No-op: handled by bun.adapter.ts calling ws.data.onCloseInternal and ws.data.onDisconnect
    })
  }

  bindMessageHandlers(
    client: ServerWebSocket<BunWsData> & BaseWsInstance,
    handlers: MessageMappingProperties[],
    transform: (data: unknown) => Observable<unknown>,
  ) {
    // Pre-build handlers map once for this client
    const handlersMap = new Map<string, MessageMappingProperties>(
      handlers.map((handler): [string, MessageMappingProperties] => [handler.message as string, handler]),
    )

    // Track if client is active
    let isActive = true

    // Create a simple close stream
    const close$ = new Observable<void>((subscriber) => {
      const closeHandler = () => {
        if (isActive) {
          isActive = false
          subscriber.next()
          subscriber.complete()
        }
      }

      // Store close handler on client data
      const originalOnCloseInternal = client.data.onCloseInternal as (() => void) | undefined
      client.data.onCloseInternal = () => {
        closeHandler()
        originalOnCloseInternal?.()
      }

      return () => {
        isActive = false
        client.data.onCloseInternal = originalOnCloseInternal
      }
    }).pipe(share())

    // Store using WeakMap to prevent memory leaks
    this.connectionCloseStreams.set(client, close$)

    // Create optimized message stream - handler will be called from global message handler
    const source$ = new Observable<WsMessageData>((subscriber) => {
      const messageHandler = (message: WsMessageData) => {
        if (isActive) {
          subscriber.next(message)
        }
      }

      // Store message handler on client data for global handler to call
      const originalOnMessageInternal = client.data.onMessageInternal as ((message: WsMessageData) => void) | undefined
      client.data.onMessageInternal = (message: WsMessageData) => {
        messageHandler(message)
        originalOnMessageInternal?.(message)
      }

      return () => {
        client.data.onMessageInternal = originalOnMessageInternal
      }
    }).pipe(
      mergeMap((message) => {
        return this.bindMessageHandler(message, handlersMap, transform).pipe(
          filter(result => !isNil(result)),
        )
      }),
      takeUntil(close$),
    )

    // Optimized onMessage handler with readyState check
    const onMessage = (response: unknown) => {
      if (isActive && client.readyState === 1) {
        client.send(JSON.stringify(response))
      }
    }

    const subscription = source$.subscribe(onMessage)

    // Cleanup on close
    close$.subscribe(() => {
      subscription.unsubscribe()
    })
  }

  override bindClientConnect(server: BunPreflightHttpServer, callback: Function): void {
    // Set the open handler (NestJS only calls this once per gateway)
    this.onOpenHandler = callback as (ws: ServerWebSocket<unknown>) => void
  }

  override bindClientDisconnect(client: ServerWebSocket<BunWsData> & BaseWsInstance, callback: Function): void {
    // Store disconnect callback directly on client data
    const originalOnDisconnect = client.data.onDisconnect as ((ws: ServerWebSocket<unknown>) => void) | undefined

    client.data.onDisconnect = (ws: ServerWebSocket<unknown>) => {
      originalOnDisconnect?.(ws)
      ;(callback as (ws: ServerWebSocket<unknown>) => void)(ws)
    }
  }

  override async close(server: BunPreflightHttpServer): Promise<void> {
    await server.close()
  }

  private bindMessageHandler(
    data: WsMessageData,
    handlersMap: Map<string, MessageMappingProperties>,
    transform: (data: unknown) => Observable<unknown>,
  ): Observable<unknown> {
    try {
      const message = this.messageParser(data)
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!message?.event || !message?.data) return EMPTY
      const messageHandler = handlersMap.get(message.event)
      if (!messageHandler) return EMPTY
      const { callback } = messageHandler
      return transform(callback(message.data, message.event))
    }
    catch (e) {
      this.logger.warn('Failed to parse WebSocket message', e)
      return EMPTY
    }
  }
}
