import { Controller, Get, INestApplication, Req, Session } from '@nestjs/common'
import { Server, randomUUIDv7 } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Test } from '@nestjs/testing'
import { join } from 'node:path'
import session from 'express-session'
import { tmpdir } from 'node:os'

import { BunAdapter } from '../../../bun.adapter.js'

@Controller()
class DummyController {
  @Get()
  getRoot(@Req() req: { session?: { visits?: number } }) {
    req.session = req.session ?? {}
    req.session.visits = (req.session.visits ?? 0) + 1
    return {
      visits: req.session.visits,
    }
  }

  @Get('session')
  getSession(@Session() session: { visits?: number }) {
    session.visits = (session.visits ?? 0) + 1
    return {
      visits: session.visits,
    }
  }
}

describe('BunAdapter Popular Middleware', () => {
  describe('session', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [DummyController],
      }).compile()
      app = moduleRef.createNestApplication(new BunAdapter())
      app.use(session({
        secret: randomUUIDv7(),
        resave: false,
        saveUninitialized: false,
      }))
      await app.listen(socket)
    })

    it('should persist session across requests', async () => {
      const res = await fetch('http://localhost', { unix: socket })
      expect(res.status).toBe(200)
      const body1 = await res.json() as { visits: number }
      expect(body1.visits).toBe(1)
      const cookie = res.headers.get('set-cookie')
      expect(cookie).toBeDefined()
      expect(cookie).not.toBeNull()

      const res2 = await fetch('http://localhost', {
        unix: socket,
        headers: {
          cookie: cookie as unknown as string,
        },
      })
      expect(res2.status).toBe(200)
      const body2 = await res2.json() as { visits: number }
      expect(body2.visits).toBe(2)
    })

    it('should persist session across requests when using @Session()', async () => {
      const res = await fetch('http://localhost/session', { unix: socket })
      expect(res.status).toBe(200)
      const body1 = await res.json() as { visits: number }
      expect(body1.visits).toBe(1)
      const cookie = res.headers.get('set-cookie')
      expect(cookie).toBeDefined()
      expect(cookie).not.toBeNull()

      const res2 = await fetch('http://localhost/session', {
        unix: socket,
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
      await Bun.file(socket).delete()
    })
  })
})
