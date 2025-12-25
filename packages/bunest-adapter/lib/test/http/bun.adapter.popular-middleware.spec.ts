import { Controller, Get, INestApplication } from '@nestjs/common'
import { Server, randomUUIDv7 } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Test } from '@nestjs/testing'
import helmet from 'helmet'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { BunAdapter } from '../../bun.adapter.js'

@Controller()
class DummyController {
  @Get()
  getRoot() {
    return 'ok'
  }
}

describe('BunAdapter Popular Middleware', () => {
  describe('helmet', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [DummyController],
      }).compile()
      app = moduleRef.createNestApplication(new BunAdapter())
      app.use(helmet())
      await app.listen(socket)
    })

    it('should set helmet headers', async () => {
      const res = await fetch('http://localhost', { unix: socket })
      expect(res.status).toBe(200)
      /**
       * Helmet sets the following headers by default:
       *
       * - `Content-Security-Policy`: A powerful allow-list of what can happen on your page which mitigates many attacks
       * - `Cross-Origin-Opener-Policy`: Helps process-isolate your page
       * - `Cross-Origin-Resource-Policy`: Blocks others from loading your resources cross-origin
       * - `Origin-Agent-Cluster`: Changes process isolation to be origin-based
       * - `Referrer-Policy`: Controls the Referer header
       * - `Strict-Transport-Security`: Tells browsers to prefer HTTPS
       * - `X-Content-Type-Options`: Avoids MIME sniffing
       * - `X-DNS-Prefetch-Control`: Controls DNS prefetching
       * - `X-Download-Options`: Forces downloads to be saved (Internet Explorer only)
       * - `X-Frame-Options`: Legacy header that mitigates clickjacking attacks
       * - `X-Permitted-Cross-Domain-Policies`: Controls cross-domain behavior for Adobe products, like Acrobat
       * - `X-Powered-By`: Info about the web server. Removed because it could be used in simple attacks
       * - `X-XSS-Protection`: Legacy header that tries to mitigate XSS attacks, but makes things worse, so Helmet disables it
       */
      expect(res.headers.get('Content-Security-Policy')).toBeDefined()
      expect(res.headers.get('Cross-Origin-Opener-Policy')).toBeDefined()
      expect(res.headers.get('Cross-Origin-Resource-Policy')).toBeDefined()
      expect(res.headers.get('Origin-Agent-Cluster')).toBeDefined()
      expect(res.headers.get('Referrer-Policy')).toBeDefined()
      expect(res.headers.get('Strict-Transport-Security')).toBeDefined()
      expect(res.headers.get('X-Content-Type-Options')).toBeDefined()
      expect(res.headers.get('X-DNS-Prefetch-Control')).toBeDefined()
      expect(res.headers.get('X-Download-Options')).toBeDefined()
      expect(res.headers.get('X-Frame-Options')).toBeDefined()
      expect(res.headers.get('X-Permitted-Cross-Domain-Policies')).toBeDefined()
      expect(res.headers.get('X-Powered-By')).toBeNull()
      expect(res.headers.get('X-XSS-Protection')).toBe('0')
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })
  })
})
