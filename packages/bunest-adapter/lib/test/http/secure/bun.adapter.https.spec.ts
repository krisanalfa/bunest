/* eslint-disable sonarjs/no-nested-functions */
import { Controller, Get, INestApplication, MessageEvent, Req, Sse } from '@nestjs/common'
import { Observable, interval, map } from 'rxjs'
import { Server, randomUUIDv7, sleep } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { EventSource } from 'eventsource'
import { Test } from '@nestjs/testing'
import { join } from 'node:path'
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

      try {
        // Collect messages for 3 seconds
        const receivedMessages = await new Promise<string[]>((resolve, reject) => {
          const messages: string[] = []
          let resolved = false
          const timeout = setTimeout(() => {
            resolved = true
            // Remove error handler before resolving to prevent unhandled errors
            eventSource.onerror = null
            resolve(messages)
          }, 3000)

          eventSource.onopen = () => {
            // Connection opened successfully
          }

          eventSource.onmessage = (event) => {
            // Collect received messages
            messages.push(event.data as string)
          }

          eventSource.onerror = (err) => {
            // Only reject if we haven't resolved yet (connection never opened)
            if (!resolved) {
              clearTimeout(timeout)
              // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
              reject(err)
            }
          }
        })

        // Verify we received multiple messages
        expect(receivedMessages.length).toBeGreaterThanOrEqual(2)
        // Verify each message matches the controller's format
        receivedMessages.forEach((message) => {
          expect(message).toMatch(/^SSE message \d+$/)
        })
      }
      finally {
        // Clean up event listeners before closing
        eventSource.onopen = null
        eventSource.onmessage = null
        eventSource.onerror = null
        eventSource.close()
        // Wait a bit for cleanup
        await sleep(200)
      }
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
