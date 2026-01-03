import {
  CorsOptionsDelegate,
  CorsOptions as NestCorsOptions,
} from '@nestjs/common/interfaces/external/cors-options.interface.js'
import { Serve, WebSocketHandler } from 'bun'

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

export type ServerOptions = Pick<
  Serve.Options<unknown>,
  | 'development'
  | 'maxRequestBodySize'
  | 'idleTimeout'
  | 'id'
  | 'tls'
  | 'websocket'
  | 'port'
  | 'hostname'
>
