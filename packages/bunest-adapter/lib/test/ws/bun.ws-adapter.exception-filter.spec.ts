import { ArgumentsHost, Catch, INestApplication, UseFilters, WsExceptionFilter } from '@nestjs/common'
import { MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets'
import { Server, ServerWebSocket } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Test } from '@nestjs/testing'
import { WsException } from '@nestjs/websockets'

import { BunWsAdapter, BunWsAdapterOptions } from '../../bun.ws-adapter.js'
import { BunAdapter } from '../../bun.adapter.js'

// Custom exception filter for WebSocket
@Catch(WsException)
class WsExceptionsFilter implements WsExceptionFilter {
  catch(exception: WsException, host: ArgumentsHost) {
    const client = host.switchToWs().getClient<ServerWebSocket>()
    const error = exception.getError()
    const details = typeof error === 'object' ? error : { message: error }

    client.send(
      JSON.stringify({
        event: 'error',
        data: {
          message: 'Exception caught by filter',
          details,
        },
      }),
    )
  }
}

// Gateway with exception filter
@WebSocketGateway<BunWsAdapterOptions>()
@UseFilters(WsExceptionsFilter)
class ExceptionFilterGateway {
  @SubscribeMessage('throwError')
  handleThrowError(@MessageBody() data: { message: string }) {
    throw new WsException(data.message || 'Test exception')
  }

  @SubscribeMessage('throwObjectError')
  handleThrowObjectError(@MessageBody() data: { code: number, details: string }) {
    throw new WsException({
      statusCode: data.code || 400,
      message: 'Object error',
      details: data.details || 'Something went wrong',
    })
  }

  @SubscribeMessage('success')
  handleSuccess(@MessageBody() data: string) {
    return {
      event: 'success',
      data: `Received: ${data}`,
    }
  }
}

async function createWebSocketClientAndWaitUntilOpen(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url)
  await new Promise<void>((resolve) => {
    socket.addEventListener('open', () => {
      resolve()
    })
  })
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

describe('BunWsAdapter ExceptionFilter', () => {
  let app: INestApplication<Server<unknown>>
  let url: string

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ExceptionFilterGateway],
    }).compile()

    app = moduleRef.createNestApplication(new BunAdapter())
    app.useWebSocketAdapter(new BunWsAdapter(app))
    await app.listen(0)
    const server = app.getHttpAdapter().getHttpServer() as Server<unknown>
    url = server.url.toString()
  })

  afterAll(async () => {
    await app.close()
  })

  it('should catch WsException and handle it with custom filter', async () => {
    const socket = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))

    const errorResponse = await new Promise<{
      event: string
      data: { id: string, message: string, details: { message?: string } }
    }>((resolve) => {
      socket.addEventListener('message', (event) => {
        const data = JSON.parse(event.data as string) as {
          event: string
          data: { id: string, message: string, details: { message?: string } }
        }
        if (data.event === 'error') {
          resolve(data)
        }
      })

      socket.send(JSON.stringify({ event: 'throwError', data: { message: 'Custom error message' } }))
    })

    expect(errorResponse.event).toBe('error')
    expect(errorResponse.data.message).toBe('Exception caught by filter')
    expect(errorResponse.data.details.message).toBe('Custom error message')

    await closeWebSocketClientAndWaitUntilClosed(socket)
  })

  it('should catch WsException with object error and handle it with custom filter', async () => {
    const socket = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))

    const errorResponse = await new Promise<{
      event: string
      data: { id: string, message: string, details: { statusCode: number, message: string, details: string } }
    }>((resolve) => {
      socket.addEventListener('message', (event) => {
        const data = JSON.parse(event.data as string) as {
          event: string
          data: { id: string, message: string, details: { statusCode: number, message: string, details: string } }
        }
        if (data.event === 'error') {
          resolve(data)
        }
      })

      socket.send(
        JSON.stringify({
          event: 'throwObjectError',
          data: { code: 403, details: 'Access denied' },
        }),
      )
    })

    expect(errorResponse.event).toBe('error')
    expect(errorResponse.data.message).toBe('Exception caught by filter')
    expect(errorResponse.data.details.statusCode).toBe(403)
    expect(errorResponse.data.details.message).toBe('Object error')
    expect(errorResponse.data.details.details).toBe('Access denied')

    await closeWebSocketClientAndWaitUntilClosed(socket)
  })

  it('should process normal messages without triggering exception filter', async () => {
    const socket = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))

    const successResponse = await new Promise<{
      event: string
      data: string
    }>((resolve) => {
      socket.addEventListener('message', (event) => {
        const data = JSON.parse(event.data as string) as { event: string, data: string }
        if (data.event === 'success') {
          resolve(data)
        }
      })

      socket.send(JSON.stringify({ event: 'success', data: 'Hello WebSocket' }))
    })

    expect(successResponse.event).toBe('success')
    expect(successResponse.data).toBe('Received: Hello WebSocket')

    await closeWebSocketClientAndWaitUntilClosed(socket)
  })
})
