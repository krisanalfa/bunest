import { Server, ServerWebSocket } from 'bun'
import { BaseWsInstance } from '@nestjs/websockets'

import { WsData, WsOptions } from './bun.internal.types.js'
import { BunServerInstance } from './bun.server-instance.js'

/**
 * Bun HTTP server placeholder used before the actual server instance is created.
 * This class provides compatibility methods expected by NestJS framework.
 *
 * There's limitation in Bun where we can't create the server instance without
 * listening on a port right away. This placeholder allows us to defer
 * the server creation until NestJS calls the listen method.
 */
export class BunPreflightHttpServer implements BaseWsInstance {
  constructor(private readonly serverInstance: BunServerInstance) {}

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
    await this.serverInstance.stop(force)
  }

  address() {
    return this.serverInstance.address()
  }

  setWsOptions(options: WsOptions) {
    this.serverInstance.setWsOptions(options)
  }

  registerWsOpenHandler(handler: (ws: ServerWebSocket<unknown>) => void) {
    this.serverInstance.registerWsOpenHandler(handler)
  }

  registerWsMessageHandler(handler: (ws: ServerWebSocket<unknown>, message: WsData, server: Server<unknown>) => void) {
    this.serverInstance.registerWsMessageHandler(handler)
  }

  registerWsCloseHandler(handler: (ws: ServerWebSocket<unknown>, code: number, reason: string) => void) {
    this.serverInstance.registerWsCloseHandler(handler)
  }

  getBunServer(): Server<unknown> | null {
    return this.serverInstance.getBunServer()
  }

  /**
   * Proxy method for WebSocket server close
   */
  async close(): Promise<void> {
    await this.serverInstance.close()
  }
}
