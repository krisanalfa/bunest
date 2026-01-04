import {
  CorsOptionsDelegate,
  CorsOptions as NestCorsOptions,
} from '@nestjs/common/interfaces/external/cors-options.interface.js'
import { Serve, Server, ServerWebSocket, WebSocketHandler } from 'bun'

import { BunRequest } from './bun.request.js'

export interface WsOptions extends Pick<
  WebSocketHandler<unknown>,
  | 'maxPayloadLength'
  | 'idleTimeout'
  | 'backpressureLimit'
  | 'closeOnBackpressureLimit'
  | 'sendPings'
  | 'publishToSelf'
  | 'perMessageDeflate'
> {
  cors?: true | NestCorsOptions | CorsOptionsDelegate<BunRequest>
  clientDataFactory?: (req: BunRequest) => unknown
}

export type ServerOptions<TWebSocketData = unknown> = Pick<
  Serve.Options<TWebSocketData>,
  | 'development'
  | 'maxRequestBodySize'
  | 'idleTimeout'
  | 'id'
  | 'tls'
  | 'websocket'
  | 'port'
  | 'hostname'
>

export type WsData = string | Buffer | ArrayBuffer | Buffer[]

export interface WsHandlers {
  onOpen: ((ws: ServerWebSocket<unknown>) => void) | undefined
  onMessage: ((ws: ServerWebSocket<unknown>, message: WsData, server: Server<unknown>) => void) | undefined
  onClose: ((ws: ServerWebSocket<unknown>, code: number, reason: string) => void) | undefined
}

export interface BunWsClientData {
  /** Called when a message is received - matches bun.adapter.ts onMessageInternal */
  onMessageInternal?: (message: WsData) => void
  /** Called when the connection closes - matches bun.adapter.ts onCloseInternal */
  onCloseInternal?: () => void
  /** Called by NestJS for disconnect handling */
  onDisconnect?: (ws: ServerWebSocket<unknown>) => void
}
