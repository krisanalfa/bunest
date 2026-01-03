import { MessageBody, SubscribeMessage, WebSocketGateway, WsResponse } from '@nestjs/websockets'
import { Observable, from, map } from 'rxjs'
import { describe, expect, it, spyOn } from 'bun:test'
import { Test } from '@nestjs/testing'

import { BunWsAdapter, BunWsAdapterOptions } from '../bun.ws-adapter.js'
import { BunAdapter } from '../bun.adapter.js'
import { BunPreflightHttpServer } from '../bun.preflight-http-server.js'

describe('Bun PreflightHttpServer', () => {
  it('should create an http server instance', async () => {
    const moduleRef = await Test.createTestingModule({
      //
    }).compile()
    const adapter = new BunAdapter({
      hostname: 'localhost',
      port: 3000,
    })
    const app = moduleRef.createNestApplication(adapter)
    await app.init()
    // At this point, .getHttpServer() should return a BunPreflightHttpServer instance
    const httpServerInstance = adapter.getHttpServer() as unknown as BunPreflightHttpServer
    expect(httpServerInstance).toBeInstanceOf(BunPreflightHttpServer)
    // once and removeListener methods should be called
    const onceSpy = spyOn(httpServerInstance, 'once')
    const removeListenerSpy = spyOn(httpServerInstance, 'removeListener')
    expect(onceSpy).toHaveBeenCalledTimes(0)
    expect(removeListenerSpy).toHaveBeenCalledTimes(0)
    await app.listen(0)
    // After calling listen, the http server instance should be replaced with a real Bun Server instance
    const realHttpServerInstance = adapter.getHttpServer()
    expect(realHttpServerInstance).not.toBeInstanceOf(BunPreflightHttpServer)
    expect(httpServerInstance.address().address).toBe('localhost')
    expect(httpServerInstance.address().port).toBeNumber() // Dynamic port
    // Closing the app should call BunPreflightHttpServer's stop method without errors
    const stopSpy = spyOn(realHttpServerInstance, 'stop')
    await app.close()
    expect(stopSpy).toHaveBeenCalled()
  })

  it('should create a websocket server instance', async () => {
    @WebSocketGateway<BunWsAdapterOptions>({ cors: true })
    class AppGateway {
      @SubscribeMessage('events')
      findAll(@MessageBody() data: unknown): Observable<WsResponse<number>> {
        return from([1, 2, 3]).pipe(map(item => ({ event: 'events', data: item, extra: data })))
      }
    }

    const moduleRef = await Test.createTestingModule({
      providers: [AppGateway],
    }).compile()
    const adapter = new BunAdapter()
    const app = moduleRef.createNestApplication(adapter)
    app.useWebSocketAdapter(new BunWsAdapter(app))
    await app.init()
    const httpServerInstance = adapter.getHttpServer() as unknown as BunPreflightHttpServer
    await app.listen(0)
    const closeSpy = spyOn(httpServerInstance, 'close')
    // Closing the app should call BunPreflightHttpServer's close method without errors
    await app.close()
    expect(closeSpy).toHaveBeenCalled()
  })
})
