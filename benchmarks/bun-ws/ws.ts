import { Injectable, Logger, Module } from '@nestjs/common'
import { MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import { NestFactory } from '@nestjs/core'
import { Server } from 'ws'
import { WsAdapter } from '@nestjs/platform-ws'

@Injectable()
@WebSocketGateway()
class AppGateway {
  @WebSocketServer()
  private readonly server!: Server

  @SubscribeMessage('peek')
  peek(@MessageBody() data: string) {
    for (const client of this.server.clients) {
      client.send(JSON.stringify({ event: 'aboo', data }))
    }
  }
}

@Module({
  providers: [AppGateway],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class AppModule {}

async function main() {
  const app = await NestFactory.create(AppModule)
  app.useWebSocketAdapter(new WsAdapter(app))
  await app.listen(3000)
  Logger.log(`Server started on http://localhost:3000`, 'NestApplication')
}

await main()
