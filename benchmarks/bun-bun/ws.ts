import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets'
import { Injectable, Logger, Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { ServerWebSocket } from 'bun'

import { BunWsAdapter, BunWsAdapterOptions } from '@packages/bunest-adapter/lib/bun.ws-adapter.js'
import { BunAdapter } from '@packages/bunest-adapter/lib/bun.adapter.js'
import { NestBunApplication } from '@packages/bunest-adapter/lib/bun.internal.types.js'

@Injectable()
@WebSocketGateway<BunWsAdapterOptions>({
  publishToSelf: true,
  perMessageDeflate: false,
  clientDataFactory(req) {
    return { uid: req.headers.get('x-user-id') ?? 'anonymous' }
  },
})
class AppGateway implements OnGatewayConnection {
  handleConnection(client: ServerWebSocket) {
    client.subscribe('room')
  }

  @SubscribeMessage('peek')
  findAll(@MessageBody() data: string, @ConnectedSocket() client: ServerWebSocket) {
    client.publishText('room', JSON.stringify({ event: 'aboo', data }))
  }
}

@Module({
  providers: [AppGateway],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class AppModule {}

async function main() {
  const app = await NestFactory.create<NestBunApplication>(AppModule, new BunAdapter())
  app.useWebSocketAdapter(new BunWsAdapter(app))
  await app.listen(3000, '127.0.0.1')
  const server = app.getHttpServer().getBunServer()
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
  Logger.log(`Server started on ${server?.url.toString()}`, 'NestApplication')
}

await main()
