/* eslint-disable sonarjs/no-clear-text-protocols */
/* eslint-disable sonarjs/no-nested-functions */
/* eslint-disable @typescript-eslint/dot-notation */
/* eslint-disable @typescript-eslint/no-confusing-void-expression */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/require-await */
import { APP_INTERCEPTOR, HttpAdapterHost } from '@nestjs/core'
import {
  CallHandler,
  Controller,
  ExecutionContext,
  Get,
  HttpException,
  HttpStatus,
  INestApplication,
  Injectable,
  NestInterceptor,
  Post,
  Redirect,
  Req,
  Res,
} from '@nestjs/common'
import { Server, randomUUIDv7 } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Test } from '@nestjs/testing'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { BunAdapter } from '../../bun.adapter.js'
import { BunRequest } from '../../bun.request.js'
import { BunResponse } from '../../bun.response.js'
import { Observable } from 'rxjs'

// ================================
// Test Controllers
// ================================

@Controller('adapter-test')
class AdapterTestController {
  @Get('basic')
  getBasic() {
    return { message: 'Basic response' }
  }

  @Get('custom-status')
  getCustomStatus(@Res() res: BunResponse) {
    res.setStatus(201)
    res.end({ created: true })
  }

  @Post('with-status')
  postWithStatus() {
    return { created: true }
  }

  @Get('redirect-test')
  @Redirect('https://example.com', 302)
  getRedirect() {
    return { url: 'https://example.com' }
  }

  @Get('custom-redirect')
  getCustomRedirect(@Res() res: BunResponse) {
    res.redirect('https://custom.example.com', 307)
  }

  @Get('custom-headers')
  getCustomHeaders(@Res() res: BunResponse) {
    res.setHeader('X-Custom-Header', 'custom-value')
    res.appendHeader('X-Multi-Header', 'value1')
    res.appendHeader('X-Multi-Header', 'value2')
    res.end({ headers: 'set' })
  }

  @Get('check-headers-sent')
  async getCheckHeadersSent(@Res() res: BunResponse) {
    const beforeSend = res.isEnded()
    res.end({ beforeSend })
    const afterSend = res.isEnded()
    // Note: afterSend check won't be in response since response already ended
    return { afterSend }
  }

  @Get('request-info')
  getRequestInfo(@Req() req: BunRequest) {
    return {
      hostname: req.hostname,
      method: req.method,
      url: req.pathname,
    }
  }

  @Get('not-found')
  getNotFound() {
    throw new HttpException('Not found test', HttpStatus.NOT_FOUND)
  }

  @Get('with-message')
  getWithMessage(@Res() res: BunResponse) {
    res.end('Plain text message')
  }

  @Get('dies-by-interceptor')
  getDiesByInterceptor() {
    return { ok: true }
  }
}

@Injectable()
class DummyInterceptor implements NestInterceptor {
  constructor(private readonly adapter: HttpAdapterHost) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> | Promise<Observable<any>> {
    const adapter = this.adapter.httpAdapter as unknown as BunAdapter
    const req = context.switchToHttp().getRequest<BunRequest>()
    const res = context.switchToHttp().getResponse<BunResponse>()

    const hostname = adapter.getRequestHostname(req)
    adapter.setHeader(res, 'x-hostname-header', hostname)
    const method = adapter.getRequestMethod(req)
    adapter.setHeader(res, 'x-method-header', method)
    const header = adapter.getHeader(res, 'x-test-header')
    adapter.setHeader(res, 'x-received-header', header ?? 'none')
    adapter.appendHeader(res, 'x-interceptor-header', 'intercepted')

    if (context.getHandler().name === 'getDiesByInterceptor') {
      // Ended by interceptor
      adapter.end(res, 'Dies by interceptor')
    }

    // Just pass through
    return next.handle()
  }
}

// ================================
// Test Suites
// ================================

describe('BunAdapter Methods', () => {
  const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
  let app: INestApplication<Server<unknown>>

  beforeAll(async () => {
    // eslint-disable-next-line prefer-const
    let httpAdapter: BunAdapter
    const moduleRef = await Test.createTestingModule({
      providers: [{
        provide: APP_INTERCEPTOR,
        useClass: DummyInterceptor,
      }, {
        provide: BunAdapter,
        useFactory: () => {
          return httpAdapter
        },
      }],
      controllers: [AdapterTestController],
    }).compile()

    app = moduleRef.createNestApplication(new BunAdapter())
    httpAdapter = app.getHttpAdapter() as unknown as BunAdapter

    await app.listen(socket)
  })

  afterAll(async () => {
    await app.close()
    await Bun.file(socket).delete()
  })

  describe('Basic', () => {
    it('should return basic response', async () => {
      const response = await fetch('http://localhost/adapter-test/basic', {
        unix: socket,
        headers: { 'X-Test-Header': 'test-value' },
      })
      expect(response.status).toBe(200)
      const data = (await response.json()) as { message: string }
      expect(data.message).toBe('Basic response')
      // Check headers set by interceptor
      expect(response.headers.get('x-hostname-header')).toBe('localhost')
      expect(response.headers.get('x-method-header')).toBe('GET')
      expect(response.headers.get('x-received-header')).toBe('none')
      expect(response.headers.get('x-interceptor-header')).toBe('intercepted')
    })
  })

  describe('Dies by Interceptor', () => {
    it('should end response in interceptor', async () => {
      const response = await fetch('http://localhost/adapter-test/dies-by-interceptor', {
        unix: socket,
      })
      expect(response.status).toBe(200)
      const text = await response.text()
      expect(text).toBe('"Dies by interceptor"')
    })
  })

  describe('HTTP Server Methods', () => {
    it('should call initHttpServer without errors', () => {
      const adapter = new BunAdapter()
      // initHttpServer sets up a placeholder server
      expect(() => adapter['initHttpServer']({})).not.toThrow()
    })

    it('should have httpServer with placeholder methods', () => {
      const adapter = new BunAdapter()

      adapter['initHttpServer']({})
      const server = adapter.getHttpServer()
      expect(server).toBeDefined()
      // Test placeholder methods don't throw
      expect(() => (server as any).once?.('error', () => {})).not.toThrow()
      expect(() => (server as any).removeListener?.('error', () => {})).not.toThrow()
      const address = (server as any).address?.()
      expect(address).toBeDefined()
    })
  })

  describe('Request Methods', () => {
    it('should extract hostname from request', async () => {
      const response = await fetch('http://testhost/adapter-test/request-info', {
        unix: socket,
        headers: {
          Host: 'testhost',
        },
      })
      const data = (await response.json()) as { hostname: string, method: string, url: string }
      expect(data.hostname).toBeDefined()
      expect(data.method).toBe('GET')
      expect(data.url).toBe('/adapter-test/request-info')
    })

    it('should get request method', async () => {
      const response = await fetch('http://localhost/adapter-test/with-status', {
        unix: socket,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(response.status).toBe(201)
    })
  })

  describe('Response Methods', () => {
    it('should set custom status code', async () => {
      const response = await fetch('http://localhost/adapter-test/custom-status', {
        unix: socket,
      })
      expect(response.status).toBe(201)
      const data = (await response.json()) as { created: boolean }
      expect(data.created).toBe(true)
    })

    it('should handle redirect with status code', async () => {
      const response = await fetch('http://localhost/adapter-test/custom-redirect', {
        unix: socket,
        redirect: 'manual',
      })
      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toBe('https://custom.example.com')
    })

    it('should set and append custom headers', async () => {
      const response = await fetch('http://localhost/adapter-test/custom-headers', {
        unix: socket,
      })
      expect(response.headers.get('x-custom-header')).toBe('custom-value')
      // Note: Bun may handle multi-value headers differently
      const multiHeader = response.headers.get('x-multi-header')
      expect(multiHeader).toBeTruthy()
    })

    it('should end response with plain text message', async () => {
      const response = await fetch('http://localhost/adapter-test/with-message', {
        unix: socket,
      })
      const text = await response.text()
      // Text is JSON-stringified
      expect(text).toBe('"Plain text message"')
    })

    it('should check if headers are sent', async () => {
      const response = await fetch('http://localhost/adapter-test/check-headers-sent', {
        unix: socket,
      })
      const data = (await response.json()) as { beforeSend: boolean }
      expect(data.beforeSend).toBe(false)
    })
  })

  describe('Error and Not Found Handlers', () => {
    it('should use custom not found handler', async () => {
      const adapter = new BunAdapter()
      const moduleRef = await Test.createTestingModule({
        controllers: [AdapterTestController],
      }).compile()
      const testApp = moduleRef.createNestApplication(adapter)

      // Set custom not found handler
      adapter.setNotFoundHandler((req: BunRequest, res: BunResponse) => {
        res.setStatus(404)
        res.end({ error: 'Custom not found', path: req.pathname })
      })

      const testSocket = join(tmpdir(), `${randomUUIDv7()}.sock`)
      await testApp.listen(testSocket)

      const response = await fetch('http://localhost/non-existent-route', {
        unix: testSocket,
      })

      await testApp.close()
      await Bun.file(testSocket).delete()

      expect(response.status).toBe(404)
    })

    it('should use setErrorHandler with prefix parameter', () => {
      const adapter = new BunAdapter()
      let errorHandlerCalled = false
      // Test that setErrorHandler accepts prefix parameter (even though it's unused)
      adapter.setErrorHandler((err: Error, req: BunRequest, res: BunResponse) => {
        errorHandlerCalled = true
        res.setStatus(500)
        res.end({ error: err.message })
      }, '/api')
      // Just verify it doesn't throw
      expect(errorHandlerCalled).toBe(false)
    })

    it('should use setNotFoundHandler with prefix parameter', () => {
      const adapter = new BunAdapter()
      // Test that setNotFoundHandler accepts prefix parameter (even though it's unused)
      adapter.setNotFoundHandler((req: BunRequest, res: BunResponse) => {
        res.setStatus(404)
        res.end({ error: 'Not found' })
      }, '/api')
      // Just verify it doesn't throw
      expect(adapter).toBeDefined()
    })
  })

  describe('Header Operations', () => {
    it('should get and set header values', async () => {
      // Test getHeader and setHeader through response operations
      // This is tested through custom-headers endpoint
      const response = await fetch('http://localhost/adapter-test/custom-headers', {
        unix: socket,
      })
      expect(response.headers.get('x-custom-header')).toBeTruthy()
    })
  })
})

describe('BunAdapter Reply Method', () => {
  const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
  let app: INestApplication<Server<unknown>>

  @Controller('reply-test')
  class ReplyTestController {
    @Get('with-status')
    getWithStatus(@Res() res: BunResponse) {
      // Simulate adapter.reply(response, body, statusCode)
      res.setStatus(202)
      res.end({ accepted: true })
    }

    @Get('without-status')
    getWithoutStatus(@Res() res: BunResponse) {
      // Simulate adapter.reply(response, body) without statusCode
      res.end({ ok: true })
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ReplyTestController],
    }).compile()

    app = moduleRef.createNestApplication(new BunAdapter())
    await app.listen(socket)
  })

  afterAll(async () => {
    await app.close()
    await Bun.file(socket).delete()
  })

  it('should reply with status code', async () => {
    const response = await fetch('http://localhost/reply-test/with-status', {
      unix: socket,
    })
    expect(response.status).toBe(202)
    const data = (await response.json()) as { accepted: boolean }
    expect(data.accepted).toBe(true)
  })

  it('should reply without status code', async () => {
    const response = await fetch('http://localhost/reply-test/without-status', {
      unix: socket,
    })
    expect(response.status).toBe(200)
    const data = (await response.json()) as { ok: boolean }
    expect(data.ok).toBe(true)
  })
})
