/* eslint-disable sonarjs/no-nested-functions */
/* eslint-disable @typescript-eslint/dot-notation */
import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer, WsResponse } from '@nestjs/websockets'
import { INestApplication, Injectable } from '@nestjs/common'
import { Observable, from, map } from 'rxjs'
import { Server, ServerWebSocket, randomUUIDv7, sleep } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Test } from '@nestjs/testing'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { BunWsAdapter, BunWsAdapterOptions } from '../../../bun.ws-adapter.js'
import { BunAdapter } from '../../../bun.adapter.js'
import { BunPreflightHttpServer } from '../../../bun.preflight-http-server.js'

@Injectable()
@WebSocketGateway<BunWsAdapterOptions>({ cors: true })
class SecureAppGateway implements OnGatewayConnection {
  @WebSocketServer()
  readonly server!: BunPreflightHttpServer

  handleConnection(client: ServerWebSocket) {
    client.send(JSON.stringify({ event: 'advertise', data: 'Welcome to secure WebSocket!' }))
  }

  @SubscribeMessage('events')
  findAll(@MessageBody() data: unknown): Observable<WsResponse<number>> {
    return from([1, 2, 3]).pipe(map(item => ({ event: 'events', data: item, extra: data })))
  }

  @SubscribeMessage('broadcast')
  broadcast(
    @MessageBody() message: string,
    @ConnectedSocket() socket: ServerWebSocket,
  ) {
    socket.publishText(
      'secure-room',
      JSON.stringify({
        event: 'broadcast',
        data: message,
      }),
    )
  }
}

describe('BunWsAdapter WSS (Secure WebSocket)', () => {
  describe('Able to setup WSS server using constructor options', () => {
    let app: INestApplication<Server<unknown>>
    let url: string
    let bunWsAdapter: BunWsAdapter

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [SecureAppGateway],
      }).compile()
      app = moduleRef.createNestApplication(new BunAdapter({
        tls: {
          cert: Bun.file(join(__dirname, 'localhost.crt')),
          key: Bun.file(join(__dirname, 'localhost.key')),
        },
      }))
      bunWsAdapter = new BunWsAdapter(app)
      app.useWebSocketAdapter(bunWsAdapter)
      await app.listen(0)
      const server = app.getHttpAdapter().getHttpServer() as Server<unknown>
      url = server.url.toString()
    })

    it('url should start with https://', () => {
      expect(url.startsWith('https://')).toBe(true)
    })

    it('should be able to connect to WSS server', async () => {
      const ws = new WebSocket(url.replace('https', 'wss'), {
        tls: { rejectUnauthorized: false },
      })
      const openResult = await new Promise<boolean>((resolve) => {
        ws.addEventListener('open', () => {
          resolve(true)
        })
      })
      expect(openResult).toBe(true)
      expect(ws.readyState).toBe(WebSocket.OPEN)

      ws.close()
      const closeResult = await new Promise<boolean>((resolve) => {
        ws.addEventListener('close', () => {
          resolve(true)
        })
      })
      expect(closeResult).toBe(true)
      expect(ws.readyState).toBe(WebSocket.CLOSED)
    })

    it('should handle connection events over WSS', async () => {
      const ws = new WebSocket(url.replace('https', 'wss'), {
        tls: { rejectUnauthorized: false },
      })

      const advertiseEvent = await new Promise<unknown>((resolve) => {
        ws.addEventListener('message', (event) => {
          const data = JSON.parse(event.data as string) as { event: string, data: unknown }
          if (data.event === 'advertise') {
            resolve(data.data)
          }
        })
      })

      expect(ws.readyState).toBe(WebSocket.OPEN)
      expect(advertiseEvent).toBeDefined()
      expect(advertiseEvent).toBe('Welcome to secure WebSocket!')

      ws.close()
      await new Promise<void>((resolve) => {
        ws.addEventListener('close', () => {
          resolve()
        })
      })
    })

    it('should be able to send and receive messages over WSS', async () => {
      const ws = new WebSocket(url.replace('https', 'wss'), {
        tls: { rejectUnauthorized: false },
      })

      await new Promise<void>((resolve) => {
        ws.addEventListener('open', () => {
          resolve()
        })
      })

      const result = await new Promise<unknown>((resolve) => {
        ws.addEventListener('message', (event) => {
          const data = JSON.parse(event.data as string) as { event: string, data: unknown, extra: string }
          if (data.event === 'events') {
            resolve([data.data, data.extra])
          }
        })
        ws.send(JSON.stringify({ event: 'events', data: 'secure-test' }))
      })

      expect(result).toEqual([1, 'secure-test'])

      ws.close()
      await new Promise<void>((resolve) => {
        ws.addEventListener('close', () => {
          resolve()
        })
      })
    })

    afterAll(async () => {
      // Wait a bit for WebSocket connections to fully close
      await new Promise(resolve => setTimeout(resolve, 100))
      await app.close()
    })
  })

  describe('Able to setup WSS server using createNestApplication options', () => {
    let app: INestApplication<Server<unknown>>
    let url: string
    let bunWsAdapter: BunWsAdapter

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [SecureAppGateway],
      }).compile()
      app = moduleRef.createNestApplication(new BunAdapter(), {
        httpsOptions: {
          cert: Bun.file(join(__dirname, 'localhost.crt')),
          key: Bun.file(join(__dirname, 'localhost.key')),
        },
      })
      bunWsAdapter = new BunWsAdapter(app)
      app.useWebSocketAdapter(bunWsAdapter)
      await app.listen(0)
      const server = app.getHttpAdapter().getHttpServer() as Server<unknown>
      url = server.url.toString()
    })

    it('url should start with https://', () => {
      expect(url.startsWith('https://')).toBe(true)
    })

    it('should be able to send and receive messages over WSS', async () => {
      const ws = new WebSocket(url.replace('https', 'wss'), {
        tls: { rejectUnauthorized: false },
      })

      await new Promise<void>((resolve) => {
        ws.addEventListener('open', () => {
          resolve()
        })
      })

      const result = await new Promise<unknown>((resolve) => {
        ws.addEventListener('message', (event) => {
          const data = JSON.parse(event.data as string) as { event: string, data: unknown, extra: string }
          if (data.event === 'events') {
            resolve([data.data, data.extra])
          }
        })
        ws.send(JSON.stringify({ event: 'events', data: 'secure-test-2' }))
      })

      expect(result).toEqual([1, 'secure-test-2'])

      ws.close()
      await new Promise<void>((resolve) => {
        ws.addEventListener('close', () => {
          resolve()
        })
      })
    })

    afterAll(async () => {
      // Wait a bit for WebSocket connections to fully close
      await sleep(100)
      await app.close()
    })
  })

  describe('Unix Socket Support with WSS', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>
    let bunWsAdapter: BunWsAdapter

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [SecureAppGateway],
      }).compile()
      app = moduleRef.createNestApplication(new BunAdapter({
        tls: {
          cert: Bun.file(join(__dirname, 'localhost.crt')),
          key: Bun.file(join(__dirname, 'localhost.key')),
        },
      }))
      bunWsAdapter = new BunWsAdapter(app)
      app.useWebSocketAdapter(bunWsAdapter)
      await app.listen(socket)
    })

    it('should be able to listen on Unix socket with WSS', () => {
      expect(bunWsAdapter).toBeDefined()
      expect(bunWsAdapter['httpServer']).toBeDefined()
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })
  })
})
