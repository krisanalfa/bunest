/* eslint-disable sonarjs/no-nested-functions */
import { ArgumentMetadata, ArgumentsHost, Catch, INestApplication, Injectable, PipeTransform, UseFilters, UsePipes, ValidationPipe, WsExceptionFilter } from '@nestjs/common'
import { IsInt, IsNotEmpty, IsString, Max, Min, MinLength } from 'class-validator'
import { MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets'
import { Server, ServerWebSocket } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Test } from '@nestjs/testing'
import { WsException } from '@nestjs/websockets'

import { BunWsAdapter, BunWsAdapterOptions } from '../../bun.ws-adapter.js'
import { BunAdapter } from '../../bun.adapter.js'

// DTO for validation
class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  name!: string

  @IsInt()
  @Min(18)
  @Max(100)
  age!: number
}

// Custom transformation pipe
@Injectable()
class UppercasePipe implements PipeTransform {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  transform(value: string, metadata: ArgumentMetadata) {
    if (typeof value !== 'string') {
      throw new WsException('Value must be a string')
    }
    return value.toUpperCase()
  }
}

@Catch(WsException)
class WsExceptionsFilter implements WsExceptionFilter {
  catch(exception: WsException, host: ArgumentsHost) {
    const client = host.switchToWs().getClient<ServerWebSocket>()
    const error = exception.getError()
    const details = typeof error === 'object' ? error : { message: error }

    client.send(
      JSON.stringify({
        event: 'error',
        data: details,
      }),
    )
  }
}

// Gateway with ValidationPipe
@WebSocketGateway<BunWsAdapterOptions>()
@UseFilters(WsExceptionsFilter)
@UsePipes(new ValidationPipe({
  exceptionFactory: errors => new WsException(errors),
}))
class ValidationGateway {
  @SubscribeMessage('createUser')
  handleCreateUser(@MessageBody() data: CreateUserDto) {
    return {
      event: 'userCreated',
      data: {
        name: data.name,
        age: data.age,
        message: 'User created successfully',
      },
    }
  }
}

// Gateway with custom pipe
@WebSocketGateway<BunWsAdapterOptions>()
class CustomPipeGateway {
  @SubscribeMessage('uppercase')
  @UsePipes(UppercasePipe)
  handleUppercase(@MessageBody() text: string) {
    return {
      event: 'uppercased',
      data: text,
    }
  }

  @SubscribeMessage('withoutPipe')
  handleWithoutPipe(@MessageBody() text: string) {
    return {
      event: 'echo',
      data: text,
    }
  }
}

// Gateway with parameter-level pipe
@WebSocketGateway<BunWsAdapterOptions>()
class ParameterPipeGateway {
  @SubscribeMessage('transform')
  handleTransform(@MessageBody(UppercasePipe) text: string) {
    return {
      event: 'transformed',
      data: text,
    }
  }

  @SubscribeMessage('validate')
  handleValidate(@MessageBody(new ValidationPipe()) data: CreateUserDto) {
    return {
      event: 'validated',
      data: {
        name: data.name,
        age: data.age,
      },
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

describe('BunWsAdapter Pipes', () => {
  describe('ValidationPipe at gateway level', () => {
    let app: INestApplication<Server<unknown>>
    let url: string

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [ValidationGateway],
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

    it('should validate and process valid data', async () => {
      const socket = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))

      const response = await new Promise<{
        event: string
        data: { name: string, age: number, message: string }
      }>((resolve) => {
        socket.addEventListener('message', (event) => {
          const data = JSON.parse(event.data as string) as {
            event: string
            data: { name: string, age: number, message: string }
          }
          if (data.event === 'userCreated') {
            resolve(data)
          }
        })

        socket.send(JSON.stringify({
          event: 'createUser',
          data: { name: 'John', age: 25 },
        }))
      })

      expect(response.event).toBe('userCreated')
      expect(response.data.name).toBe('John')
      expect(response.data.age).toBe(25)
      expect(response.data.message).toBe('User created successfully')

      await closeWebSocketClientAndWaitUntilClosed(socket)
    })

    it('should validate another valid user', async () => {
      const socket = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))

      const response = await new Promise<{
        event: string
        data: { name: string, age: number, message: string }
      }>((resolve) => {
        socket.addEventListener('message', (event) => {
          const data = JSON.parse(event.data as string) as {
            event: string
            data: { name: string, age: number, message: string }
          }
          if (data.event === 'userCreated') {
            resolve(data)
          }
        })

        socket.send(JSON.stringify({
          event: 'createUser',
          data: { name: 'Alice', age: 30 },
        }))
      })

      expect(response.event).toBe('userCreated')
      expect(response.data.name).toBe('Alice')
      expect(response.data.age).toBe(30)

      await closeWebSocketClientAndWaitUntilClosed(socket)
    })

    it('should validate invalid user', async () => {
      const socket = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))

      const response = await new Promise<{
        constraints: Record<string, string>
      }[]>((resolve) => {
        socket.addEventListener('message', (event) => {
          const data = JSON.parse(event.data as string) as {
            event: string
            data: {
              constraints: Record<string, string>
            }[]
          }
          if (data.event === 'error') {
            resolve(data.data)
          }
        })

        socket.send(JSON.stringify({
          event: 'createUser',
          data: { name: 'Al', age: 15 },
        }))
      })
      expect(response).toBeDefined()
      expect(response.length).toBe(2)
      const nameError = response.find(err => err.constraints.minLength)
      expect(nameError).toBeDefined()
      const ageError = response.find(err => err.constraints.min)
      expect(ageError).toBeDefined()

      await closeWebSocketClientAndWaitUntilClosed(socket)
    })
  })

  describe('Custom transformation pipe', () => {
    let app: INestApplication<Server<unknown>>
    let url: string

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [CustomPipeGateway],
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

    it('should transform input to uppercase using custom pipe', async () => {
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
          if (data.event === 'uppercased') {
            resolve(data)
          }
        })

        socket.send(JSON.stringify({
          event: 'uppercase',
          data: 'hello world',
        }))
      })

      expect(response.event).toBe('uppercased')
      expect(response.data).toBe('HELLO WORLD')

      await closeWebSocketClientAndWaitUntilClosed(socket)
    })

    it('should handle messages without pipe transformation', async () => {
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
          if (data.event === 'echo') {
            resolve(data)
          }
        })

        socket.send(JSON.stringify({
          event: 'withoutPipe',
          data: 'hello world',
        }))
      })

      expect(response.event).toBe('echo')
      expect(response.data).toBe('hello world')

      await closeWebSocketClientAndWaitUntilClosed(socket)
    })
  })

  describe('Parameter-level pipes', () => {
    let app: INestApplication<Server<unknown>>
    let url: string

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [ParameterPipeGateway],
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

    it('should apply transformation pipe at parameter level', async () => {
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
          if (data.event === 'transformed') {
            resolve(data)
          }
        })

        socket.send(JSON.stringify({
          event: 'transform',
          data: 'lowercase text',
        }))
      })

      expect(response.event).toBe('transformed')
      expect(response.data).toBe('LOWERCASE TEXT')

      await closeWebSocketClientAndWaitUntilClosed(socket)
    })

    it('should apply validation pipe at parameter level', async () => {
      const socket = await createWebSocketClientAndWaitUntilOpen(url.replace('http', 'ws'))

      const response = await new Promise<{
        event: string
        data: { name: string, age: number }
      }>((resolve) => {
        socket.addEventListener('message', (event) => {
          const data = JSON.parse(event.data as string) as {
            event: string
            data: { name: string, age: number }
          }
          if (data.event === 'validated') {
            resolve(data)
          }
        })

        socket.send(JSON.stringify({
          event: 'validate',
          data: { name: 'Alice', age: 30 },
        }))
      })

      expect(response.event).toBe('validated')
      expect(response.data.name).toBe('Alice')
      expect(response.data.age).toBe(30)

      await closeWebSocketClientAndWaitUntilClosed(socket)
    })
  })
})
