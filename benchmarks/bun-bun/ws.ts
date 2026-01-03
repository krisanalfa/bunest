import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets'
import { Injectable, Logger, Module } from '@nestjs/common'
import { Server, ServerWebSocket } from 'bun'
import { NestFactory } from '@nestjs/core'

import { BunWsAdapter, BunWsAdapterOptions } from '@packages/bunest-adapter/lib/bun.ws-adapter.js'
import { BunAdapter } from '@packages/bunest-adapter/lib/bun.adapter.js'

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
  const app = await NestFactory.create(AppModule, new BunAdapter())
  app.useWebSocketAdapter(new BunWsAdapter(app))
  await app.listen(3000, '127.0.0.1')
  const server = app.getHttpAdapter().getHttpServer() as Server<unknown>
  Logger.log(`Server started on ${server.url.toString()}`, 'NestApplication')
}

await main()
