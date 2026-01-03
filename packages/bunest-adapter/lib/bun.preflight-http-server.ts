import { Server, ServerWebSocket } from 'bun'
import { BaseWsInstance } from '@nestjs/websockets'

import { ServerOptions, WsOptions } from './internal.types.js'

interface BunHttpAdapter {
  setWsOptions(options: WsOptions): void
  getBunHttpServerInstance(): Server<unknown>
  getWsHandlers(): {
    onOpen: ((ws: ServerWebSocket<unknown>) => void) | undefined
    onMessage: ((ws: ServerWebSocket<unknown>, message: string | ArrayBuffer | Buffer | Buffer[], server: Server<unknown>) => void) | undefined
    onClose: ((ws: ServerWebSocket<unknown>, code: number, reason: string) => void) | undefined
  }
  getBunServerOptions(): Pick<
    ServerOptions,
    | 'port'
    | 'hostname'
  >
}

/**
 * Bun HTTP server placeholder used before the actual server instance is created.
 * This class provides compatibility methods expected by NestJS framework.
 *
 * There's limitation in Bun where we can't create the server instance without
 * listening on a port right away. This placeholder allows us to defer
 * the server creation until NestJS calls the listen method.
 */
export class BunPreflightHttpServer implements BaseWsInstance {
  constructor(private readonly adapter: BunHttpAdapter) {}

  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type, @typescript-eslint/no-unused-vars
  on(event: string, callback: Function): void {
    // no operation
  }

  /**
   * NestJS compatibility methods
   * Nest use this to listen for "error" events during HTTP server initialization
   */
  once() {
    // no operation
  }

  /**
   * NestJS compatibility methods
   * Nest use this to remove "error" event listeners during HTTP server cleanup
   */
  removeListener() {
    // no operation
  }

  /**
   * NestJS compatibility methods
   */
  async stop(force?: boolean): Promise<void> {
    const server = this.adapter.getBunHttpServerInstance()
    if (server instanceof BunPreflightHttpServer) {
      // If the server is still a dummy, there's nothing to stop
      return
    }
    await server.stop(force)
  }

  address() {
    const server = this.adapter.getBunHttpServerInstance()
    if (server instanceof BunPreflightHttpServer) {
      const options = this.adapter.getBunServerOptions()
      return {
        address: options.hostname ?? '127.0.0.1',
        port: options.port ?? 3000,
      }
    }

    return {
      address: server.hostname,
      port: server.port,
    }
  }

  setWsOptions(options: WsOptions) {
    this.adapter.setWsOptions(options)
  }

  registerWsOpenHandler(handler: (ws: ServerWebSocket<unknown>) => void) {
    this.adapter.getWsHandlers().onOpen = handler
  }

  registerWsMessageHandler(handler: (ws: ServerWebSocket<unknown>, message: string | ArrayBuffer | Buffer | Buffer[], server: Server<unknown>) => void) {
    this.adapter.getWsHandlers().onMessage = handler
  }

  registerWsCloseHandler(handler: (ws: ServerWebSocket<unknown>, code: number, reason: string) => void) {
    this.adapter.getWsHandlers().onClose = handler
  }

  getWsHandlers() {
    return this.adapter.getWsHandlers()
  }

  getBunServer(): Server<unknown> {
    return this.adapter.getBunHttpServerInstance()
  }

  /**
   * Proxy method for WebSocket server close
   */
  async close(): Promise<void> {
    await this.stop(true)
  }
}
