import {
  CorsOptions,
  CorsOptionsDelegate,
} from '@nestjs/common/interfaces/external/cors-options.interface.js'
import { Serve, Server, ServerWebSocket, WebSocketHandler } from 'bun'
import { INestApplication } from '@nestjs/common'

import { BunRequest } from './bun.request.js'
import { BunServerInstance } from './bun.server-instance.js'

export interface WsOptions<TWebSocketData = unknown> extends Pick<
  WebSocketHandler<TWebSocketData>,
  | 'maxPayloadLength'
  | 'idleTimeout'
  | 'backpressureLimit'
  | 'closeOnBackpressureLimit'
  | 'sendPings'
  | 'publishToSelf'
  | 'perMessageDeflate'
> {
  cors?: true | CorsOptions | CorsOptionsDelegate<BunRequest>
  /**
   * Factory to create the client data for each WebSocket connection.
   *
   * @param req The incoming Bun request
   * @returns The client data object to be associated with the WebSocket connection
   */
  clientDataFactory?: (req: BunRequest) => TWebSocketData
}

export type GraphQLWsOptions<TWebSocketData = unknown> = WebSocketHandler<TWebSocketData> & {
  /**
   * Factory to create the client data for each WebSocket connection.
   *
   * @param req The incoming Bun request
   * @returns The client data object to be associated with the WebSocket connection
   */
  clientDataFactory?: WsOptions['clientDataFactory']
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
> & {
  /**
   * Whether to support GraphQL over HTTP.
   *
   * There's known limitation with NestJS Apollo GraphQL module where
   * it doesn't support any other HTTP adapters except Express and Fastify.
   * When this option is enabled, Bunest adapter will override the `getType` method
   * of the underlying Bun HTTP server to always return 'express' so that
   * NestJS Apollo module can work correctly.
   *
   * If you supply a WebSocketHandler here, it will be used for handling
   * WebSocket connections instead of the default one. This is mainly used for subscriptions.
   * If you don't use subscriptions, you can just set this to `true`.
   *
   * @default false
   */
  withGraphQL?: boolean | GraphQLWsOptions<TWebSocketData>
}

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

export interface BunStaticAssetsOptions {
  /**
   * Enable static assets serving.
   *
   * Bun has two distict modes for serving static assets:
   * 1. Static routes
   * 2. File routes
   *
   * If you set `useStatic: true`, Bun will use static routes for serving assets.
   * This approach is generally faster for serving static files, as it serves
   * files directly from memory. However, it comes with some limitations, such as
   * lack of support for certain features like range requests and directory indexing.
   * On top of that, static routes didn't respect middlewares due to Bun's internal design.
   *
   * On the other hand, if you set `useStatic: false` (the default behavior),
   * Bun will use file routes, which read files from the filesystem on each request.
   * This method supports a wider range of features, including range requests, and respects
   * middlewares. However, it may be slightly slower than static routes due to
   * filesystem access on each request.
   *
   * @see https://bun.com/docs/runtime/http/routing#file-responses-vs-static-responses
   * @defaults false Use file routes by default.
   */
  useStatic?: boolean
}

export interface NestBunApplication extends INestApplication<BunServerInstance> {
  useStaticAssets(path: string, options?: BunStaticAssetsOptions): void
  enableCors(options?: CorsOptions | CorsOptionsDelegate<BunRequest>): void
}
