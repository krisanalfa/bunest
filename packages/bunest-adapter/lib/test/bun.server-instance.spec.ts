import { MessageBody, SubscribeMessage, WebSocketGateway, WsResponse } from '@nestjs/websockets'
import { Observable, from, map } from 'rxjs'
import { describe, expect, it, spyOn } from 'bun:test'
import { Test } from '@nestjs/testing'

import { BunWsAdapter, BunWsAdapterOptions } from '../bun.ws-adapter.js'
import { NestBunApplication, WsOptions } from '../bun.internal.types.js'
import { BunAdapter } from '../bun.adapter.js'
import { BunServerInstance } from '../bun.server-instance.js'

describe('BunServerInstance', () => {
  it('should create an http server instance', async () => {
    const moduleRef = await Test.createTestingModule({
      //
    }).compile()
    const adapter = new BunAdapter({
      hostname: 'localhost',
      port: 3000,
    })
    const app = moduleRef.createNestApplication<NestBunApplication>(adapter)
    await app.init()
    // At this point, .getHttpServer() should return a BunServerInstance
    const httpServerInstance = adapter.getHttpServer() as unknown as BunServerInstance
    expect(httpServerInstance).toBeInstanceOf(BunServerInstance)
    // once and removeListener methods should be callable
    const onceSpy = spyOn(httpServerInstance, 'once')
    const removeListenerSpy = spyOn(httpServerInstance, 'removeListener')
    expect(onceSpy).toHaveBeenCalledTimes(0)
    expect(removeListenerSpy).toHaveBeenCalledTimes(0)
    await app.listen(0)
    // After calling listen, the http server instance should be replaced with a real Bun Server instance
    const realHttpServerInstance = adapter.getHttpServer()
    expect(realHttpServerInstance).not.toBeInstanceOf(BunServerInstance)
    expect(httpServerInstance.address().address).toBe('localhost')
    expect(httpServerInstance.address().port).toBeNumber() // Dynamic port
    // Closing the app should call stop method without errors
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
    const httpServerInstance = adapter.getHttpServer() as unknown as BunServerInstance
    await app.listen(0)
    const closeSpy = spyOn(httpServerInstance, 'close')
    // Closing the app should call close method without errors
    await app.close()
    expect(closeSpy).toHaveBeenCalled()
  })

  it('should call stop() on server instance', async () => {
    const moduleRef = await Test.createTestingModule({
      //
    }).compile()
    const adapter = new BunAdapter()
    const app = moduleRef.createNestApplication(adapter)
    await app.init()
    const httpServerInstance = adapter.getHttpServer() as unknown as BunServerInstance
    expect(httpServerInstance).toBeInstanceOf(BunServerInstance)
    // Create spy for stop method
    const serverInstance: BunServerInstance = adapter.getInstance()
    const stopSpy = spyOn(serverInstance, 'stop')
    // Call stop through close method
    await httpServerInstance.close()
    expect(stopSpy).toHaveBeenCalled()
    await app.close()
  })

  it('should call address() and return server address', async () => {
    const moduleRef = await Test.createTestingModule({
      //
    }).compile()
    const adapter = new BunAdapter({ hostname: 'localhost' })
    const app = moduleRef.createNestApplication(adapter)
    await app.init()
    const httpServerInstance = adapter.getHttpServer() as unknown as BunServerInstance
    expect(httpServerInstance).toBeInstanceOf(BunServerInstance)
    // Address should return the expected structure
    const addressInfo = httpServerInstance.address()
    expect(addressInfo).toBeDefined()
    expect(addressInfo.address).toBe('localhost')
    await app.close()
  })

  it('should delegate WebSocket methods to server instance', async () => {
    const moduleRef = await Test.createTestingModule({
      //
    }).compile()
    const adapter = new BunAdapter()
    const app = moduleRef.createNestApplication(adapter)
    await app.init()
    const httpServerInstance = adapter.getHttpServer() as unknown as BunServerInstance
    expect(httpServerInstance).toBeInstanceOf(BunServerInstance)

    // Test setWsOptions
    const wsOptions: WsOptions = { cors: true }
    httpServerInstance.setWsOptions(wsOptions)

    // Test getBunServer
    const bunServer = httpServerInstance.getBunServer()
    expect(bunServer).toBeNull() // Not started yet

    await app.close()
  })
})
