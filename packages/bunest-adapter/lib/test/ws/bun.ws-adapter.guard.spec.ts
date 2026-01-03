/* eslint-disable sonarjs/no-nested-functions */
import { ArgumentsHost, CanActivate, Catch, ExecutionContext, INestApplication, Injectable, UseFilters, UseGuards, WsExceptionFilter } from '@nestjs/common'
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
          message: 'Access denied',
          details,
        },
      }),
    )
  }
}

// Auth guard that checks for a token
@Injectable()
class WsAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const data = context.switchToWs().getData<{ token?: string }>()

    if (data.token !== 'valid-token') {
      throw new WsException('Unauthorized')
    }

    return true
  }
}

// Role-based guard
@Injectable()
class WsRolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const data = context.switchToWs().getData<{ role?: string }>()

    if (data.role !== 'admin') {
      throw new WsException({
        statusCode: 403,
        message: 'Forbidden',
        error: 'Insufficient permissions',
      })
    }

    return true
  }
}

// Gateway with guards at gateway level
@WebSocketGateway<BunWsAdapterOptions>()
@UseFilters(WsExceptionsFilter)
@UseGuards(WsAuthGuard)
class GuardedGateway {
  @SubscribeMessage('protected')
  handleProtected(@MessageBody() data: { message: string }) {
    return {
      event: 'protected',
      data: `Protected message: ${data.message}`,
    }
  }

  @SubscribeMessage('public')
  handlePublic(@MessageBody() data: { message: string }) {
    return {
      event: 'public',
      data: `Public message: ${data.message}`,
    }
  }
}

// Gateway with guards at handler level
@WebSocketGateway<BunWsAdapterOptions>()
@UseFilters(WsExceptionsFilter)
class HandlerGuardedGateway {
  @SubscribeMessage('adminOnly')
  @UseGuards(WsRolesGuard)
  handleAdminOnly(@MessageBody() data: { action: string }) {
    return {
      event: 'adminAction',
      data: `Admin action: ${data.action}`,
    }
  }

  @SubscribeMessage('userAction')
  handleUserAction(@MessageBody() data: { action: string }) {
    return {
      event: 'userAction',
      data: `User action: ${data.action}`,
    }
  }
}

// Gateway with multiple guards
@WebSocketGateway<BunWsAdapterOptions>()
@UseFilters(WsExceptionsFilter)
class MultiGuardGateway {
  @SubscribeMessage('secureAction')
  @UseGuards(WsAuthGuard, WsRolesGuard)
  handleSecureAction(@MessageBody() data: { action: string }) {
    return {
      event: 'secureAction',
      data: `Secure action: ${data.action}`,
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

describe('BunWsAdapter Guards', () => {
  describe('Gateway-level guards', () => {
    let app: INestApplication<Server<unknown>>
    let url: string

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [GuardedGateway, WsAuthGuard],
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

    it('should allow access with valid token', async () => {
      const socket = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))

      const response = await new Promise<{
        event: string
        data: string
      }>((resolve) => {
        socket.addEventListener('message', (event) => {
          const data = JSON.parse(event.data as string) as {
            event: string
            data: string
          }
          if (data.event === 'protected') {
            resolve(data)
          }
        })

        socket.send(JSON.stringify({
          event: 'protected',
          data: { message: 'Hello', token: 'valid-token' },
        }))
      })

      expect(response.event).toBe('protected')
      expect(response.data).toBe('Protected message: Hello')

      await closeWebSocketClientAndWaitUntilClosed(socket)
    })

    it('should deny access without token', async () => {
      const socket = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))

      const errorResponse = await new Promise<{
        event: string
        data: { message: string, details: { message?: string } }
      }>((resolve) => {
        socket.addEventListener('message', (event) => {
          const data = JSON.parse(event.data as string) as {
            event: string
            data: { message: string, details: { message?: string } }
          }
          if (data.event === 'error') {
            resolve(data)
          }
        })

        socket.send(JSON.stringify({
          event: 'protected',
          data: { message: 'Hello' },
        }))
      })

      expect(errorResponse.event).toBe('error')
      expect(errorResponse.data.message).toBe('Access denied')
      expect(errorResponse.data.details.message).toBe('Unauthorized')

      await closeWebSocketClientAndWaitUntilClosed(socket)
    })

    it('should deny access with invalid token', async () => {
      const socket = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))

      const errorResponse = await new Promise<{
        event: string
        data: { message: string, details: { message?: string } }
      }>((resolve) => {
        socket.addEventListener('message', (event) => {
          const data = JSON.parse(event.data as string) as {
            event: string
            data: { message: string, details: { message?: string } }
          }
          if (data.event === 'error') {
            resolve(data)
          }
        })

        socket.send(JSON.stringify({
          event: 'protected',
          data: { message: 'Hello', token: 'invalid-token' },
        }))
      })

      expect(errorResponse.event).toBe('error')
      expect(errorResponse.data.message).toBe('Access denied')
      expect(errorResponse.data.details.message).toBe('Unauthorized')

      await closeWebSocketClientAndWaitUntilClosed(socket)
    })

    it('should apply guard to all handlers in gateway', async () => {
      const socket = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))

      const errorResponse = await new Promise<{
        event: string
        data: { message: string, details: { message?: string } }
      }>((resolve) => {
        socket.addEventListener('message', (event) => {
          const data = JSON.parse(event.data as string) as {
            event: string
            data: { message: string, details: { message?: string } }
          }
          if (data.event === 'error') {
            resolve(data)
          }
        })

        socket.send(JSON.stringify({
          event: 'public',
          data: { message: 'Hello' },
        }))
      })

      expect(errorResponse.event).toBe('error')
      expect(errorResponse.data.message).toBe('Access denied')

      await closeWebSocketClientAndWaitUntilClosed(socket)
    })
  })

  describe('Handler-level guards', () => {
    let app: INestApplication<Server<unknown>>
    let url: string

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [HandlerGuardedGateway, WsRolesGuard],
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

    it('should allow admin access with admin role', async () => {
      const socket = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))

      const response = await new Promise<{
        event: string
        data: string
      }>((resolve) => {
        socket.addEventListener('message', (event) => {
          const data = JSON.parse(event.data as string) as {
            event: string
            data: string
          }
          if (data.event === 'adminAction') {
            resolve(data)
          }
        })

        socket.send(JSON.stringify({
          event: 'adminOnly',
          data: { action: 'delete user', role: 'admin' },
        }))
      })

      expect(response.event).toBe('adminAction')
      expect(response.data).toBe('Admin action: delete user')

      await closeWebSocketClientAndWaitUntilClosed(socket)
    })

    it('should deny admin access without admin role', async () => {
      const socket = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))

      const errorResponse = await new Promise<{
        event: string
        data: { message: string, details: { statusCode?: number, message?: string, error?: string } }
      }>((resolve) => {
        socket.addEventListener('message', (event) => {
          const data = JSON.parse(event.data as string) as {
            event: string
            data: { message: string, details: { statusCode?: number, message?: string, error?: string } }
          }
          if (data.event === 'error') {
            resolve(data)
          }
        })

        socket.send(JSON.stringify({
          event: 'adminOnly',
          data: { action: 'delete user', role: 'user' },
        }))
      })

      expect(errorResponse.event).toBe('error')
      expect(errorResponse.data.message).toBe('Access denied')
      expect(errorResponse.data.details.statusCode).toBe(403)
      expect(errorResponse.data.details.message).toBe('Forbidden')
      expect(errorResponse.data.details.error).toBe('Insufficient permissions')

      await closeWebSocketClientAndWaitUntilClosed(socket)
    })

    it('should allow unguarded handler without role', async () => {
      const socket = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))

      const response = await new Promise<{
        event: string
        data: string
      }>((resolve) => {
        socket.addEventListener('message', (event) => {
          const data = JSON.parse(event.data as string) as {
            event: string
            data: string
          }
          if (data.event === 'userAction') {
            resolve(data)
          }
        })

        socket.send(JSON.stringify({
          event: 'userAction',
          data: { action: 'read data' },
        }))
      })

      expect(response.event).toBe('userAction')
      expect(response.data).toBe('User action: read data')

      await closeWebSocketClientAndWaitUntilClosed(socket)
    })
  })

  describe('Multiple guards', () => {
    let app: INestApplication<Server<unknown>>
    let url: string

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [MultiGuardGateway, WsAuthGuard, WsRolesGuard],
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

    it('should allow access when all guards pass', async () => {
      const socket = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))

      const response = await new Promise<{
        event: string
        data: string
      }>((resolve) => {
        socket.addEventListener('message', (event) => {
          const data = JSON.parse(event.data as string) as {
            event: string
            data: string
          }
          if (data.event === 'secureAction') {
            resolve(data)
          }
        })

        socket.send(JSON.stringify({
          event: 'secureAction',
          data: { action: 'critical operation', token: 'valid-token', role: 'admin' },
        }))
      })

      expect(response.event).toBe('secureAction')
      expect(response.data).toBe('Secure action: critical operation')

      await closeWebSocketClientAndWaitUntilClosed(socket)
    })

    it('should deny access when first guard fails', async () => {
      const socket = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))

      const errorResponse = await new Promise<{
        event: string
        data: { message: string, details: { message?: string } }
      }>((resolve) => {
        socket.addEventListener('message', (event) => {
          const data = JSON.parse(event.data as string) as {
            event: string
            data: { message: string, details: { message?: string } }
          }
          if (data.event === 'error') {
            resolve(data)
          }
        })

        socket.send(JSON.stringify({
          event: 'secureAction',
          data: { action: 'critical operation', role: 'admin' }, // Missing token
        }))
      })

      expect(errorResponse.event).toBe('error')
      expect(errorResponse.data.message).toBe('Access denied')
      expect(errorResponse.data.details.message).toBe('Unauthorized')

      await closeWebSocketClientAndWaitUntilClosed(socket)
    })

    it('should deny access when second guard fails', async () => {
      const socket = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))

      const errorResponse = await new Promise<{
        event: string
        data: { message: string, details: { statusCode?: number, message?: string, error?: string } }
      }>((resolve) => {
        socket.addEventListener('message', (event) => {
          const data = JSON.parse(event.data as string) as {
            event: string
            data: { message: string, details: { statusCode?: number, message?: string, error?: string } }
          }
          if (data.event === 'error') {
            resolve(data)
          }
        })

        socket.send(JSON.stringify({
          event: 'secureAction',
          data: { action: 'critical operation', token: 'valid-token', role: 'user' }, // Wrong role
        }))
      })

      expect(errorResponse.event).toBe('error')
      expect(errorResponse.data.message).toBe('Access denied')
      expect(errorResponse.data.details.statusCode).toBe(403)
      expect(errorResponse.data.details.message).toBe('Forbidden')

      await closeWebSocketClientAndWaitUntilClosed(socket)
    })

    it('should deny access when all guards fail', async () => {
      const socket = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))

      const errorResponse = await new Promise<{
        event: string
        data: { message: string, details: { message?: string } }
      }>((resolve) => {
        socket.addEventListener('message', (event) => {
          const data = JSON.parse(event.data as string) as {
            event: string
            data: { message: string, details: { message?: string } }
          }
          if (data.event === 'error') {
            resolve(data)
          }
        })

        socket.send(JSON.stringify({
          event: 'secureAction',
          data: { action: 'critical operation' }, // Missing both token and role
        }))
      })

      expect(errorResponse.event).toBe('error')
      expect(errorResponse.data.message).toBe('Access denied')

      await closeWebSocketClientAndWaitUntilClosed(socket)
    })
  })
})
