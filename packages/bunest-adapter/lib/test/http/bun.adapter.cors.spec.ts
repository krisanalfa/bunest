import {
  Controller,
  Get,
  HttpStatus,
  INestApplication,
  Post,
} from '@nestjs/common'
import { Server, randomUUIDv7 } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js'
import { Test } from '@nestjs/testing'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { BunAdapter } from '../../bun.adapter.js'
import { BunRequest } from '../../bun.request.js'

// ================================
// Test Controllers
// ================================

@Controller('cors-test')
class CorsTestController {
  @Get()
  getCorsTest() {
    return { message: 'CORS test endpoint' }
  }

  @Get('public')
  getPublic() {
    return { message: 'Public endpoint' }
  }

  @Get('private')
  getPrivate() {
    return { message: 'Private endpoint' }
  }

  @Post()
  postCorsTest() {
    return { message: 'CORS POST test' }
  }
}

// ================================
// Test Suites
// ================================

describe('BunAdapter CORS Middleware Extended', () => {
  describe('CORS with delegate function', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [CorsTestController],
      }).compile()

      app = moduleRef.createNestApplication(new BunAdapter())

      // Use delegate function for dynamic CORS options
      app.enableCors((req: BunRequest, callback: (err: Error | null, options?: CorsOptions) => void) => {
        const origin = req.headers.get('origin')

        // Allow specific origins based on request
        if (origin === 'https://allowed.example.com') {
          callback(null, {
            origin: true,
            credentials: true,
            methods: ['GET', 'POST'],
            allowedHeaders: ['Content-Type', 'Authorization'],
          })
        }
        else if (origin === 'https://readonly.example.com') {
          callback(null, {
            origin: true,
            methods: ['GET'],
          })
        }
        else {
          callback(null, {
            origin: false,
          })
        }
      })

      await app.listen(socket)
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })

    it('should allow requests from allowed origin with full permissions', async () => {
      const response = await fetch('http://localhost/cors-test', {
        unix: socket,
        headers: {
          Origin: 'https://allowed.example.com',
        },
      })
      expect(response.status).toBe(HttpStatus.OK)
      expect(response.headers.get('access-control-allow-origin')).toBe('https://allowed.example.com')
      expect(response.headers.get('access-control-allow-credentials')).toBe('true')
    })

    it('should allow preflight requests from allowed origin', async () => {
      const response = await fetch('http://localhost/cors-test', {
        unix: socket,
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://allowed.example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type',
        },
      })
      expect(response.status).toBe(HttpStatus.NO_CONTENT)
      expect(response.headers.get('access-control-allow-origin')).toBe('https://allowed.example.com')
      expect(response.headers.get('access-control-allow-methods')).toContain('GET')
      expect(response.headers.get('access-control-allow-methods')).toContain('POST')
    })

    it('should allow readonly origin with limited permissions', async () => {
      const response = await fetch('http://localhost/cors-test', {
        unix: socket,
        headers: {
          Origin: 'https://readonly.example.com',
        },
      })
      expect(response.status).toBe(HttpStatus.OK)
      expect(response.headers.get('access-control-allow-origin')).toBe('https://readonly.example.com')
    })

    it('should deny requests from unknown origin', async () => {
      const response = await fetch('http://localhost/cors-test', {
        unix: socket,
        headers: {
          Origin: 'https://unknown.example.com',
        },
      })
      expect(response.status).toBe(HttpStatus.OK)
      // Origin not allowed - no CORS headers
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
    })
  })

  describe('CORS with static options and credentials', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [CorsTestController],
      }).compile()

      app = moduleRef.createNestApplication(new BunAdapter())
      app.enableCors({
        origin: ['https://trusted.example.com', 'https://another.example.com'],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Custom-Header'],
        exposedHeaders: ['X-Response-Time', 'X-Request-Id'],
        maxAge: 86400,
      })
      await app.listen(socket)
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })

    it('should set credentials header', async () => {
      const response = await fetch('http://localhost/cors-test', {
        unix: socket,
        headers: {
          Origin: 'https://trusted.example.com',
        },
      })
      expect(response.status).toBe(HttpStatus.OK)
      expect(response.headers.get('access-control-allow-credentials')).toBe('true')
    })

    it('should expose custom headers', async () => {
      const response = await fetch('http://localhost/cors-test', {
        unix: socket,
        headers: {
          Origin: 'https://trusted.example.com',
        },
      })
      expect(response.status).toBe(HttpStatus.OK)
      const exposed = response.headers.get('access-control-expose-headers')
      expect(exposed).toContain('X-Response-Time')
      expect(exposed).toContain('X-Request-Id')
    })

    it('should set max-age on preflight', async () => {
      const response = await fetch('http://localhost/cors-test', {
        unix: socket,
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://trusted.example.com',
          'Access-Control-Request-Method': 'POST',
        },
      })
      // CORS preflight response status depends on cors library configuration
      expect(response.status).toBeLessThanOrEqual(HttpStatus.NO_CONTENT)
      expect(response.headers.get('access-control-max-age')).toBe('86400')
    })

    it('should allow multiple origins', async () => {
      const response1 = await fetch('http://localhost/cors-test', {
        unix: socket,
        headers: { Origin: 'https://trusted.example.com' },
      })
      expect(response1.headers.get('access-control-allow-origin')).toBe('https://trusted.example.com')

      const response2 = await fetch('http://localhost/cors-test', {
        unix: socket,
        headers: { Origin: 'https://another.example.com' },
      })
      expect(response2.headers.get('access-control-allow-origin')).toBe('https://another.example.com')
    })
  })

  describe('CORS with wildcard origin', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [CorsTestController],
      }).compile()

      app = moduleRef.createNestApplication(new BunAdapter())
      app.enableCors({
        origin: '*',
        methods: ['GET', 'POST'],
      })
      await app.listen(socket)
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })

    it('should allow any origin with wildcard', async () => {
      const response = await fetch('http://localhost/cors-test', {
        unix: socket,
        headers: { Origin: 'https://any-domain.com' },
      })
      expect(response.status).toBe(HttpStatus.OK)
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
    })
  })

  describe('CORS without configuration', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [CorsTestController],
      }).compile()

      app = moduleRef.createNestApplication(new BunAdapter())
      // Enable CORS without options - uses defaults
      app.enableCors()
      await app.listen(socket)
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })

    it('should use default CORS settings', async () => {
      const response = await fetch('http://localhost/cors-test', {
        unix: socket,
        headers: { Origin: 'http://localhost:3000' },
      })
      expect(response.status).toBe(HttpStatus.OK)
      // Default CORS allows any origin
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
    })
  })

  describe('CORS applies globally', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [CorsTestController],
      }).compile()

      app = moduleRef.createNestApplication(new BunAdapter())
      app.enableCors({
        origin: 'https://example.com',
        methods: ['GET', 'POST'],
      })

      await app.listen(socket)
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })

    it('should apply CORS to all routes by default', async () => {
      const response = await fetch('http://localhost/cors-test', {
        unix: socket,
        headers: { Origin: 'https://example.com' },
      })
      expect(response.status).toBe(HttpStatus.OK)
      expect(response.headers.get('access-control-allow-origin')).toBe('https://example.com')
    })

    it('should apply CORS to nested routes', async () => {
      const response = await fetch('http://localhost/cors-test/public', {
        unix: socket,
        headers: { Origin: 'https://example.com' },
      })
      expect(response.status).toBe(HttpStatus.OK)
      expect(response.headers.get('access-control-allow-origin')).toBe('https://example.com')
    })
  })

  describe('CORS delegate with error handling', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [CorsTestController],
      }).compile()

      app = moduleRef.createNestApplication(new BunAdapter(), { logger: false })

      // Use delegate function that can throw errors
      app.enableCors((req: BunRequest, callback: (err: Error | null, options?: CorsOptions) => void) => {
        const origin = req.headers.get('origin')

        // Simulate error condition
        if (origin === 'https://error.example.com') {
          callback(new Error('CORS configuration error'), undefined)
          return
        }

        callback(null, {
          origin: origin === 'https://valid.example.com',
        })
      })

      await app.listen(socket)
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })

    it('should allow valid origin through delegate', async () => {
      const response = await fetch('http://localhost/cors-test', {
        unix: socket,
        headers: { Origin: 'https://valid.example.com' },
      })
      expect(response.status).toBe(HttpStatus.OK)
    })

    it('should handle errors from delegate function', async () => {
      const response = await fetch('http://localhost/cors-test', {
        unix: socket,
        headers: { Origin: 'https://error.example.com' },
      })
      // Error in CORS delegate might result in 500 or connection error
      expect(response.status).toBe(500)
    })
  })
})
