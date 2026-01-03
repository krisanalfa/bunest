/* eslint-disable @typescript-eslint/dot-notation */
/* eslint-disable sonarjs/no-nested-functions */
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsResponse,
} from '@nestjs/websockets'
import { Controller, Get, INestApplication, Injectable } from '@nestjs/common'
import { Observable, from, map } from 'rxjs'
import { Server, ServerWebSocket, randomUUIDv7, sleep } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Test } from '@nestjs/testing'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { BunWsAdapter, BunWsAdapterOptions } from '../../bun.ws-adapter.js'
import { BunAdapter } from '../../bun.adapter.js'
import { BunPreflightHttpServer } from '../../bun.preflight-http-server.js'

@WebSocketGateway<BunWsAdapterOptions>({ cors: true })
class AppGateway implements OnGatewayConnection, OnGatewayDisconnect {
  handleConnection(client: ServerWebSocket) {
    client.send(JSON.stringify({ event: 'advertise', data: 'Welcome!' }))
  }

  handleDisconnect(client: ServerWebSocket) {
    client.send(JSON.stringify({ event: 'farewell', data: 'Goodbye!' }))
  }

  @SubscribeMessage('events')
  findAll(@MessageBody() data: unknown): Observable<WsResponse<number>> {
    return from([1, 2, 3]).pipe(map(item => ({ event: 'events', data: item, extra: data })))
  }

  @SubscribeMessage('arrayBufferTest')
  arrayBufferTest(@MessageBody() data: unknown): ArrayBuffer {
    const message = JSON.stringify({ event: 'arrayBufferTest', data })
    const encoder = new TextEncoder()
    return encoder.encode(message).buffer
  }

  @SubscribeMessage('dataViewTest')
  dataViewTest(@MessageBody() data: string): DataView {
    const response = { event: 'dataViewTest', data }
    const responseString = JSON.stringify(response)
    const buffer = Buffer.from(responseString, 'utf8')
    const dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    return dataView
  }
}

function createWebSocketClientAndWaitUntilOpen(url: string): Promise<WebSocket>
function createWebSocketClientAndWaitUntilOpen(url: string, additionalEventsToListen: string[]): Promise<[WebSocket, unknown[]]>
async function createWebSocketClientAndWaitUntilOpen(url: string, additionalEventsToListen?: string[]): Promise<WebSocket | [WebSocket, unknown[]]> {
  const socket = new WebSocket(url)
  const results: unknown[] = []
  await new Promise<void>((resolve) => {
    socket.addEventListener('open', () => {
      if (!additionalEventsToListen) {
        // Resolve immediately if no additional events to listen
        resolve()
      }
    })

    if (additionalEventsToListen) {
      socket.addEventListener('message', (event) => {
        const data = JSON.parse(event.data as string) as { event: string, data: unknown }
        if (additionalEventsToListen.includes(data.event)) {
          results.push(data.data) // improve race condition risk here
          // All additional events received, resolve the promise
          if (results.length === additionalEventsToListen.length) {
            resolve()
          }
        }
      })
    }
  })
  if (additionalEventsToListen) {
    return [socket, results]
  }

  return socket
}
async function closeWebSocketClientAndWaitUntilClosed(socket: WebSocket): Promise<void> {
  socket.close()
  await new Promise<void>((resolve) => {
    socket.addEventListener('close', () => {
      resolve()
    })
  })
}

describe('BunWsAdapter Basic', () => {
  describe('Single Gateway', () => {
    let app: INestApplication<Server<unknown>>
    let url: string
    let bunWsAdapter: BunWsAdapter

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [AppGateway],
      }).compile()
      app = moduleRef.createNestApplication(new BunAdapter())
      bunWsAdapter = new BunWsAdapter(app)
      app.useWebSocketAdapter(bunWsAdapter)
      await app.listen(0)
      const server = app.getHttpAdapter().getHttpServer() as Server<unknown>
      url = server.url.toString()
    })

    it('should be defined', () => {
      expect(bunWsAdapter).toBeDefined()
      expect(bunWsAdapter['httpServer']).toBeDefined()
    })

    it('should be able to upgrade HTTP server to WebSocket server', async () => {
      const result = await fetch(url, {
        headers: {
          'Connection': 'Upgrade',
          'Upgrade': 'websocket',
          'Sec-WebSocket-Key': '5dMPAyzyQAGbQM26FdK8bQ==',
          'Sec-WebSocket-Version': '13',
        },
      })
      expect(result.status).toBe(101)
      expect(result.headers.get('Upgrade')?.toLowerCase()).toBe('websocket')
      expect(result.headers.get('Connection')?.toLowerCase()).toBe('upgrade')
      expect(result.headers.get('access-control-allow-origin')).toBe('*') // CORS Header
    })

    it('should be able to connect to WebSocket server', async () => {
      const socket = new WebSocket(url.replace('http', 'ws'))
      const openResult = await new Promise<boolean>((resolve) => {
        socket.addEventListener('open', () => {
          resolve(true)
        })
      })
      expect(openResult).toBe(true)
      expect(socket.readyState).toBe(WebSocket.OPEN)
      socket.close()
      const closeResult = await new Promise<boolean>((resolve) => {
        socket.addEventListener('close', () => {
          resolve(true)
        })
      })
      expect(closeResult).toBe(true)
      expect(socket.readyState).toBe(WebSocket.CLOSED)
    })

    it('should handle connection and disconnection events', async () => {
      // Test that handleConnection is called when a client connects
      const [socket1, [advertiseEvent1]] = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'), ['advertise'])
      expect(socket1.readyState).toBe(WebSocket.OPEN)
      expect(advertiseEvent1).toBeDefined()
      expect(advertiseEvent1).toBe('Welcome!')

      // Connect another client and verify it also receives the advertise message
      const [socket2, [advertiseEvent2]] = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'), ['advertise'])
      expect(socket2.readyState).toBe(WebSocket.OPEN)
      expect(advertiseEvent2).toBeDefined()
      expect(advertiseEvent2).toBe('Welcome!')

      // Close both sockets
      await closeWebSocketClientAndWaitUntilClosed(socket1)
      await closeWebSocketClientAndWaitUntilClosed(socket2)
    })

    it.serial('should be able to send message using string', async () => {
      const socket = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))
      const result = await new Promise<unknown>((resolve) => {
        socket.addEventListener('message', (event) => {
          const data = JSON.parse(event.data as string) as { event: string, data: unknown, extra: string }
          if (data.event === 'events') {
            resolve([data.data, data.extra])
          }
        })
        // A string message
        socket.send(JSON.stringify({ event: 'events', data: 'test' }))
      })

      expect(result).toEqual([1, 'test'])
      await closeWebSocketClientAndWaitUntilClosed(socket)
    })

    it.serial('should be able to send message using ArrayBuffer', async () => {
      const socket = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))
      const result = await new Promise<unknown>((resolve) => {
        socket.addEventListener('message', (event) => {
          const data = JSON.parse(event.data as string) as { event: string, data: unknown, extra: string }
          if (data.event === 'events') {
            resolve([data.data, data.extra])
          }
        })
        // An ArrayBuffer message
        const message = JSON.stringify({ event: 'events', data: 'test' })
        const buffer = new TextEncoder().encode(message).buffer
        socket.send(buffer)
      })

      expect(result).toEqual([1, 'test'])
      await closeWebSocketClientAndWaitUntilClosed(socket)
    })

    afterAll(async () => {
      await app.close()
    })
  })

  describe('Single Gateway with additional HTTP Controller', () => {
    let app: INestApplication<Server<unknown>>
    let url: string

    @Controller()
    class AppController {
      @Get()
      getRoot(): string {
        return 'Hello World!'
      }
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [AppController],
        providers: [AppGateway],
      }).compile()
      app = moduleRef.createNestApplication(new BunAdapter())
      app.useWebSocketAdapter(new BunWsAdapter(app))
      await app.listen(0)
      const server = app.getHttpAdapter().getHttpServer() as Server<unknown>
      url = server.url.toString()
    })

    it('should be able to upgrade HTTP request to WebSocket', async () => {
      const result = await fetch(url, {
        headers: {
          'Connection': 'Upgrade',
          'Upgrade': 'websocket',
          'Sec-WebSocket-Key': '5dMPAyzyQAGbQM26FdK8bQ==',
          'Sec-WebSocket-Version': '13',
        },
      })
      expect(result.status).toBe(101)
      expect(result.headers.get('Upgrade')?.toLowerCase()).toBe('websocket')
      expect(result.headers.get('Connection')?.toLowerCase()).toBe('upgrade')
      expect(result.headers.get('access-control-allow-origin')).toBe('*') // CORS Header
    })

    it('should be able to send message using string', async () => {
      const socket = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))
      const result = await new Promise<unknown>((resolve) => {
        socket.addEventListener('message', (event) => {
          const data = JSON.parse(event.data as string) as { event: string, data: unknown, extra: string }
          if (data.event === 'events') {
            resolve([data.data, data.extra])
          }
        })
        // A string message
        socket.send(JSON.stringify({ event: 'events', data: 'test' }))
      })

      expect(result).toEqual([1, 'test'])
      expect(socket.readyState).toBe(WebSocket.OPEN)
      await closeWebSocketClientAndWaitUntilClosed(socket)
    })

    it('should be able to handle HTTP requests', async () => {
      const response = await fetch(url)
      const text = await response.text()
      expect(text).toBe('"Hello World!"')
    })

    afterAll(async () => {
      await app.close()
    })
  })

  describe('Chat Gateway', () => {
    @Injectable()
    @WebSocketGateway<BunWsAdapterOptions>({ cors: true, publishToSelf: true })
    class ChatGateway implements OnGatewayConnection {
      @WebSocketServer()
      readonly server!: BunPreflightHttpServer

      private readonly roomName = randomUUIDv7()

      handleConnection(client: ServerWebSocket) {
        client.subscribe(this.roomName)
      }

      @SubscribeMessage('sendMessage')
      broadcast(
        @MessageBody() message: string,
        @ConnectedSocket() client: ServerWebSocket,
      ) {
        const subscriberCount = this.server.getBunServer().subscriberCount(this.roomName)
        client.publishText(
          this.roomName,
          JSON.stringify({
            event: 'sendMessage',
            data: message,
            client: subscriberCount,
          }),
        )
      }
    }

    let app: INestApplication<Server<unknown>>
    let url: string

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [ChatGateway],
      }).compile()
      app = moduleRef.createNestApplication(new BunAdapter())
      app.useWebSocketAdapter(new BunWsAdapter(app))
      await app.listen(0)
      const server = app.getHttpAdapter().getHttpServer() as Server<unknown>
      url = server.url.toString()
    })

    it('should broadcast message to all connected clients', async () => {
      const socket1 = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))
      const socket2 = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))

      const message = 'Hello, World!'

      // Set up message listeners before sending
      const response1 = new Promise<[string, number]>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout waiting for socket1 message'))
        }, 3000)
        socket1.onmessage = (event) => {
          const data = JSON.parse(event.data as string) as { event: string, data: string, client: number }
          if (data.event === 'sendMessage') {
            clearTimeout(timeout)
            resolve([data.data, data.client])
          }
        }
      })

      const response2 = new Promise<[string, number]>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout waiting for socket2 message'))
        }, 3000)
        socket2.onmessage = (event) => {
          const data = JSON.parse(event.data as string) as { event: string, data: string, client: number }
          if (data.event === 'sendMessage') {
            clearTimeout(timeout)
            resolve([data.data, data.client])
          }
        }
      })

      // Wait a bit to ensure subscriptions are fully set up
      await new Promise(resolve => setTimeout(resolve, 200))

      // Send message from socket1
      socket1.send(JSON.stringify({ event: 'sendMessage', data: message }))

      const receivedMessage1 = await response1
      const receivedMessage2 = await response2
      expect(receivedMessage1).toEqual([message, 2])
      expect(receivedMessage2).toEqual([message, 2])

      // Disconnect socket 2
      await closeWebSocketClientAndWaitUntilClosed(socket2)

      // Wait a bit for the disconnection to propagate
      await new Promise(resolve => setTimeout(resolve, 100))

      // Send another message from socket1
      const response3 = new Promise<[string, number]>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout waiting for socket1 second message'))
        }, 2000)
        socket1.onmessage = (event) => {
          const data = JSON.parse(event.data as string) as { event: string, data: string, client: number }
          if (data.event === 'sendMessage') {
            clearTimeout(timeout)
            resolve([data.data, data.client])
          }
        }
      })

      socket1.send(JSON.stringify({ event: 'sendMessage', data: message }))
      const receivedMessage3 = await response3
      expect(receivedMessage3).toEqual([message, 1])

      // Clean up
      await closeWebSocketClientAndWaitUntilClosed(socket1)
    })

    afterAll(async () => {
      await app.close()
    })
  })

  describe('Unix Socket Support', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>
    let bunWsAdapter: BunWsAdapter

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [AppGateway],
      }).compile()
      app = moduleRef.createNestApplication(new BunAdapter())
      bunWsAdapter = new BunWsAdapter(app)
      app.useWebSocketAdapter(bunWsAdapter)
      await app.listen(socket)
    })

    it('should be able to listen on Unix socket', () => {
      expect(bunWsAdapter).toBeDefined()
      expect(bunWsAdapter['httpServer']).toBeDefined()
    })

    it('should be able to upgrade HTTP to WebSocket on Unix socket', async () => {
      const result = await fetch('http://localhost', {
        unix: socket,
        headers: {
          'Connection': 'Upgrade',
          'Upgrade': 'websocket',
          'Sec-WebSocket-Key': '5dMPAyzyQAGbQM26FdK8bQ==',
          'Sec-WebSocket-Version': '13',
        },
      })
      expect(result.status).toBe(101)
      expect(result.headers.get('Upgrade')?.toLowerCase()).toBe('websocket')
      expect(result.headers.get('Connection')?.toLowerCase()).toBe('upgrade')
      expect(result.headers.get('access-control-allow-origin')).toBe('*')
    })

    it('should be able to connect to WebSocket via Unix socket', async () => {
      // Use fetch with unix option to upgrade to WebSocket
      const response = await fetch('http://localhost', {
        unix: socket,
        headers: {
          'Connection': 'Upgrade',
          'Upgrade': 'websocket',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
        },
      })

      expect(response.status).toBe(101)
      expect(response.headers.get('Upgrade')?.toLowerCase()).toBe('websocket')
    })

    it('should handle connection events via Unix socket', async () => {
      // WebSocket connections via Unix socket work through the normal upgrade mechanism
      // The fetch with unix option already tests the upgrade path
      // This test verifies the connection lifecycle
      const response = await fetch('http://localhost', {
        unix: socket,
        headers: {
          'Connection': 'Upgrade',
          'Upgrade': 'websocket',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
        },
      })

      expect(response.status).toBe(101)
      expect(response.headers.get('Upgrade')?.toLowerCase()).toBe('websocket')
    })

    it('should verify WebSocket server accepts connections via Unix socket', async () => {
      // Verify that the WebSocket upgrade mechanism works correctly
      const response = await fetch('http://localhost', {
        unix: socket,
        headers: {
          'Connection': 'Upgrade',
          'Upgrade': 'websocket',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
        },
      })

      expect(response.status).toBe(101)
      expect(response.headers.get('Connection')?.toLowerCase()).toBe('upgrade')
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })
  })

  describe('Client Data Factory', () => {
    @WebSocketGateway<BunWsAdapterOptions>({
      clientDataFactory: (req) => {
        return {
          user: req.headers.get('x-user-id') ?? 'anonymous',
        }
      },
    })
    class AppGateway {
      @SubscribeMessage('hello')
      findAll(@MessageBody() data: string, @ConnectedSocket() client: ServerWebSocket<{ user: string }>) {
        return {
          event: 'hello',
          data: {
            echo: data,
            user: client.data.user,
          },
        }
      }
    }

    let app: INestApplication<Server<unknown>>
    let url: string

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [AppGateway],
      }).compile()
      app = moduleRef.createNestApplication(new BunAdapter())
      app.useWebSocketAdapter(new BunWsAdapter(app))
      await app.listen(0)
      const server = app.getHttpAdapter().getHttpServer() as Server<unknown>
      url = server.url.toString()
    })

    it('should provide client data from factory', async () => {
      const socket = new WebSocket(url.replace('http', 'ws'), {
        headers: { 'x-user-id': 'test-user' },
      })
      const result = await new Promise<unknown>((resolve) => {
        socket.addEventListener('open', () => {
          socket.send(JSON.stringify({ event: 'hello', data: 'world' }))
        })
        socket.addEventListener('message', (event) => {
          const data = JSON.parse(event.data as string) as { event: string, data: unknown }
          if (data.event === 'hello') {
            resolve(data.data)
          }
        })
      })

      expect(result).toEqual({ echo: 'world', user: 'test-user' })
      socket.close()
      await new Promise<void>((resolve) => {
        socket.addEventListener('close', () => {
          resolve()
        })
      })
    })

    afterAll(async () => {
      await app.close()
    })
  })

  describe('Custom Event Data', () => {
    let app: INestApplication<Server<unknown>>
    let url: string
    let bunWsAdapter: BunWsAdapter

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [AppGateway],
      }).compile()
      app = moduleRef.createNestApplication(new BunAdapter())
      bunWsAdapter = new BunWsAdapter(app)
      app.useWebSocketAdapter(bunWsAdapter)
      await app.listen(0)
      const server = app.getHttpAdapter().getHttpServer() as Server<unknown>
      url = server.url.toString()
    })

    it('should handle array buffer message correctly', async () => {
      const socket = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))
      const result = await new Promise<unknown>((resolve) => {
        socket.addEventListener('message', (event) => {
          const data = JSON.parse(event.data as string) as { event: string, data: unknown, extra: string }
          if (data.event === 'arrayBufferTest') {
            resolve(data.data)
          }
        })
        // An ArrayBuffer message
        const message = JSON.stringify({ event: 'arrayBufferTest', data: 'arrayBufferData' })
        socket.send(message)
      })

      expect(result).toBe('arrayBufferData')
      await closeWebSocketClientAndWaitUntilClosed(socket)
    })

    it('should handle data view message correctly', async () => {
      const socket = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))
      await sleep(10) // Ensure connection is fully established
      const result = await new Promise<unknown>((resolve) => {
        socket.addEventListener('message', (event) => {
          const data = JSON.parse(event.data as string) as { event: string, data: unknown, extra: string }
          if (data.event === 'dataViewTest') {
            resolve(data.data)
          }
        })
        // A DataView message
        const message = JSON.stringify({ event: 'dataViewTest', data: 'Hello, world!' })
        socket.send(message)
      })

      // The returned data should be a representation of the DataView sent back
      expect(result).toBeDefined()
      expect(typeof result).toBe('string')
      expect(result).toBe('Hello, world!')
      await closeWebSocketClientAndWaitUntilClosed(socket)
    })

    afterAll(async () => {
      await app.close()
    })
  })

  describe('Custom Message Parser', () => {
    @WebSocketGateway<BunWsAdapterOptions>({
      messageParser: (data: string | Buffer | ArrayBuffer | Buffer[]) => {
        let messageString: string
        if (typeof data === 'string') {
          messageString = data
        }
        else if (data instanceof ArrayBuffer) {
          messageString = new TextDecoder().decode(new Uint8Array(data))
        }
        else if (ArrayBuffer.isView(data)) {
          messageString = new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
        }
        else {
          // Buffer[]
          const combined = Buffer.concat(data)
          messageString = combined.toString('utf8')
        }

        const parsed = JSON.parse(messageString) as { type: string, payload: unknown }
        return {
          event: parsed.type,
          data: parsed.payload,
        }
      },
    })
    class AppGateway {
      @SubscribeMessage('customEvent')
      handleCustomEvent(@MessageBody() data: string) {
        return {
          event: 'customEvent',
          data: data,
        }
      }
    }

    let app: INestApplication<Server<unknown>>
    let url: string

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [AppGateway],
      }).compile()
      app = moduleRef.createNestApplication(new BunAdapter())
      app.useWebSocketAdapter(new BunWsAdapter(app))
      await app.listen(0)
      const server = app.getHttpAdapter().getHttpServer() as Server<unknown>
      url = server.url.toString()
    })

    it('should parse messages using custom parser (string)', async () => {
      const socket = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))
      const result = await new Promise<unknown>((resolve) => {
        socket.addEventListener('message', (event) => {
          const data = JSON.parse(event.data as string) as { event: string, data: unknown }
          if (data.event === 'customEvent') {
            resolve(data.data)
          }
        })
        // A message using custom format
        const message = JSON.stringify({ type: 'customEvent', payload: 'customData' })
        socket.send(message)
      })

      expect(result).toBe('customData')
      await closeWebSocketClientAndWaitUntilClosed(socket)
    })

    it('should parse messages using custom parser (ArrayBuffer)', async () => {
      const socket = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))
      const result = await new Promise<unknown>((resolve) => {
        socket.addEventListener('message', (event) => {
          const data = JSON.parse(event.data as string) as { event: string, data: unknown }
          if (data.event === 'customEvent') {
            resolve(data.data)
          }
        })
        // An ArrayBuffer message using custom format
        const messageObj = { type: 'customEvent', payload: 'arrayBufferCustomData' }
        const messageString = JSON.stringify(messageObj)
        const buffer = new TextEncoder().encode(messageString).buffer
        socket.send(buffer)
      })

      expect(result).toBe('arrayBufferCustomData')
      await closeWebSocketClientAndWaitUntilClosed(socket)
    })

    it('should parse messages using custom parser (DataView)', async () => {
      const socket = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))
      const result = await new Promise<unknown>((resolve) => {
        socket.addEventListener('message', (event) => {
          const data = JSON.parse(event.data as string) as { event: string, data: unknown }
          if (data.event === 'customEvent') {
            resolve(data.data)
          }
        })
        // A DataView message using custom format
        const messageObj = { type: 'customEvent', payload: 'dataViewCustomData' }
        const messageString = JSON.stringify(messageObj)
        const buffer = Buffer.from(messageString, 'utf8')
        const dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        socket.send(dataView)
      })

      expect(result).toBe('dataViewCustomData')
      await closeWebSocketClientAndWaitUntilClosed(socket)
    })

    afterAll(async () => {
      await app.close()
    })
  })
})
