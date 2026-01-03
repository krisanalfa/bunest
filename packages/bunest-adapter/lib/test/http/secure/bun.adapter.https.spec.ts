import { Controller, Get, INestApplication, Req } from '@nestjs/common'
import { Server, randomUUIDv7 } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
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
