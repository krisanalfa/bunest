import { Controller, Get, INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Server } from 'bun'
import { Test } from '@nestjs/testing'
import { join } from 'node:path'

import { BunAdapter } from '../../../bun.adapter.js'

@Controller()
class DummyController {
  @Get()
  getRoot() {
    return { message: 'Hello, Secure World!' }
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

    afterAll(async () => {
      await app.close()
    })
  })
})
