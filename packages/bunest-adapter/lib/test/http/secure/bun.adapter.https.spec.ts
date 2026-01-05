/* eslint-disable sonarjs/no-nested-functions */
import { Controller, Get, INestApplication, MessageEvent, Req, Session, Sse } from '@nestjs/common'
import { Observable, interval, map } from 'rxjs'
import { Server, randomUUIDv7 } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { EventSource } from 'eventsource'
import { Test } from '@nestjs/testing'
import { join } from 'node:path'
import session from 'express-session'
import { tmpdir } from 'node:os'

import { BunAdapter } from '../../../bun.adapter.js'
import { BunRequest } from '../../../bun.request.js'

@Controller()
class DummyController {
  @Get()
  getRoot() {
    return { message: 'Hello, Secure World!' }
  }

  @Get('ping')
  ping(@Req() request: BunRequest) {
    return { message: 'pong', secure: request.socket.encrypted }
  }

  @Sse('/sse')
  getSse(): Observable<MessageEvent> {
    return interval(1000).pipe(
      map(num => ({
        data: `SSE message ${num.toString()}`,
      })),
    )
  }

  @Get('session')
  getSession(@Session() session: { visits?: number }) {
    session.visits = (session.visits ?? 0) + 1
    return {
      visits: session.visits,
    }
  }
}

describe('Bun HTTPS Adapter', () => {
  describe('Able to setup HTTPS server using constructor options', () => {
    let app: INestApplication<Server<unknown>>
    let url: string

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [DummyController],
      }).compile()
      app = moduleRef.createNestApplication(new BunAdapter({
        tls: {
          cert: Bun.file(join(__dirname, 'localhost.crt')),
          key: Bun.file(join(__dirname, 'localhost.key')),
        },
      }))
      app.use(session({
        secret: randomUUIDv7(),
        resave: false,
        saveUninitialized: false,
        cookie: { secure: true },
      }))
      await app.listen(0)
      const server = app.getHttpAdapter().getHttpServer() as Server<unknown>
      url = server.url.toString()
    })

    it('url should start with https://', () => {
      expect(url.startsWith('https://')).toBe(true)
    })

    it('should handle HTTPS requests', async () => {
      const response = await fetch(url, {
        tls: { rejectUnauthorized: false },
      })
      expect(response.status).toBe(200)
      const data = await response.json() as { message: string }
      expect(data).toEqual({ message: 'Hello, Secure World!' })
    })

    it('should handle SSE requests', async () => {
      const eventSource = new EventSource(`${url}/sse`, {
        fetch: (url, init) => fetch(url, {
          ...init,
          tls: { rejectUnauthorized: false },
        }),
      })

      // Wait for connection to open
      await new Promise<void>((resolve) => {
        eventSource.onopen = () => {
          resolve()
        }
      })
      expect(eventSource.readyState).toBe(EventSource.OPEN)

      // Collect messages for 3 seconds
      const receivedMessages = await new Promise<string[]>((resolve) => {
        const messages: string[] = []
        setTimeout(() => {
          resolve(messages)
        }, 3000)

        eventSource.onmessage = (event) => {
          // Collect received messages
          messages.push(event.data as string)
        }
      })

      // Verify we received multiple messages
      expect(receivedMessages.length).toBeGreaterThanOrEqual(2)
      // Verify each message matches the controller's format
      receivedMessages.forEach((message) => {
        expect(message).toMatch(/^SSE message \d+$/)
      })
      // Respect order of messages
      for (const [index, message] of receivedMessages.entries()) {
        expect(message).toBe(`SSE message ${index.toString()}`)
      }

      eventSource.close()
    })

    it('should be able to access secure session', async () => {
      const res = await fetch(`${url}/session`, {
        tls: { rejectUnauthorized: false },
      })
      expect(res.status).toBe(200)
      const body1 = await res.json() as { visits: number }
      expect(body1.visits).toBe(1)
      const cookie = res.headers.get('set-cookie')
      expect(cookie).toBeDefined()
      expect(cookie).not.toBeNull()

      const res2 = await fetch(`${url}/session`, {
        tls: { rejectUnauthorized: false },
        headers: {
          cookie: cookie as unknown as string,
        },
      })
      expect(res2.status).toBe(200)
      const body2 = await res2.json() as { visits: number }
      expect(body2.visits).toBe(2)
    })

    afterAll(async () => {
      await app.close()
    })
  })

  describe('Able to setup HTTPS server using createNestApplication options', () => {
    let app: INestApplication<Server<unknown>>
    let url: string

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [DummyController],
      }).compile()
      app = moduleRef.createNestApplication(new BunAdapter(), {
        httpsOptions: {
          cert: Bun.file(join(__dirname, 'localhost.crt')),
          key: Bun.file(join(__dirname, 'localhost.key')),
        },
      })
      await app.listen(0)
      const server = app.getHttpAdapter().getHttpServer() as Server<unknown>
      url = server.url.toString()
    })

    it('url should start with https://', () => {
      expect(url.startsWith('https://')).toBe(true)
    })

    it('should handle HTTPS requests', async () => {
      const response = await fetch(url, {
        tls: { rejectUnauthorized: false },
      })
      expect(response.status).toBe(200)
      const data = await response.json() as { message: string }
      expect(data).toEqual({ message: 'Hello, Secure World!' })
    })

    it('should have encrypted socket in request', async () => {
      const response = await fetch(`${url}/ping`, {
        tls: { rejectUnauthorized: false },
      })
      expect(response.status).toBe(200)
      const data = await response.json() as { message: string, secure: boolean }
      expect(data).toEqual({ message: 'pong', secure: true })
    })

    afterAll(async () => {
      await app.close()
    })
  })

  describe('Unix Socket Support with HTTPS', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [DummyController],
      }).compile()
      app = moduleRef.createNestApplication(new BunAdapter({
        tls: {
          cert: Bun.file(join(__dirname, 'localhost.crt')),
          key: Bun.file(join(__dirname, 'localhost.key')),
        },
      }))
      await app.listen(socket)
    })

    it('should handle HTTPS requests via Unix socket', async () => {
      const response = await fetch('https://localhost', {
        unix: socket,
        tls: { rejectUnauthorized: false },
      })
      expect(response.status).toBe(200)
      const data = await response.json() as { message: string }
      expect(data).toEqual({ message: 'Hello, Secure World!' })
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })
  })
})
