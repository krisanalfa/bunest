import {
  Controller,
  Get,
  Head,
  Header,
  HttpStatus,
  INestApplication,
  Options,
} from '@nestjs/common'
import { Server, randomUUIDv7 } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Test } from '@nestjs/testing'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { BunAdapter } from '../../bun.adapter.js'

// ================================
// Test Controllers
// ================================

@Controller('methods')
class MethodsController {
  @Get()
  handleGet() {
    return { method: 'GET', message: 'Get response' }
  }

  @Head()
  handleHead() {
    return { method: 'HEAD', message: 'Head response' }
  }

  @Options()
  handleOptions() {
    return { method: 'OPTIONS', message: 'Options response' }
  }

  @Get('with-headers')
  @Header('X-Custom-Header', 'custom-value')
  @Header('X-Another-Header', 'another-value')
  getWithHeaders() {
    return { message: 'Response with headers' }
  }

  @Head('with-headers')
  @Header('X-Head-Header', 'head-value')
  @Header('Content-Length', '42')
  headWithHeaders() {
    return { message: 'Head with headers' }
  }

  @Options('custom')
  @Header('Allow', 'GET, POST, OPTIONS')
  @Header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  customOptions() {
    return { allowed: ['GET', 'POST', 'OPTIONS'] }
  }
}

@Controller('resource')
class ResourceController {
  @Get(':id')
  getResource() {
    return {
      id: '123',
      name: 'Test Resource',
      createdAt: new Date().toISOString(),
    }
  }

  @Head(':id')
  @Header('X-Resource-Exists', 'true')
  @Header('X-Resource-Type', 'test')
  headResource() {
    // HEAD should not return body
    return {}
  }

  @Options(':id')
  @Header('Allow', 'GET, HEAD, PUT, DELETE, OPTIONS')
  optionsResource() {
    return { methods: ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS'] }
  }
}

// ================================
// Test Suites
// ================================

describe('BunAdapter OPTIONS Method', () => {
  const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
  let app: INestApplication<Server<unknown>>

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MethodsController, ResourceController],
    }).compile()

    app = moduleRef.createNestApplication(new BunAdapter())
    await app.listen(socket)
  })

  afterAll(async () => {
    await app.close()
    await Bun.file(socket).delete()
  })

  describe('Basic OPTIONS handling', () => {
    it('should handle OPTIONS request', async () => {
      const response = await fetch('http://localhost/methods', {
        unix: socket,
        method: 'OPTIONS',
      })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { method: string }
      expect(data.method).toBe('OPTIONS')
    })

    it('should handle OPTIONS request with custom path', async () => {
      const response = await fetch('http://localhost/methods/custom', {
        unix: socket,
        method: 'OPTIONS',
      })
      expect(response.status).toBe(HttpStatus.OK)
      expect(response.headers.get('allow')).toBe('GET, POST, OPTIONS')
      expect(response.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS')
    })

    it('should handle OPTIONS request for resource with id', async () => {
      const response = await fetch('http://localhost/resource/123', {
        unix: socket,
        method: 'OPTIONS',
      })
      expect(response.status).toBe(HttpStatus.OK)
      expect(response.headers.get('allow')).toBe('GET, HEAD, PUT, DELETE, OPTIONS')
    })
  })
})

describe('BunAdapter HEAD Method', () => {
  const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
  let app: INestApplication<Server<unknown>>

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MethodsController, ResourceController],
    }).compile()

    app = moduleRef.createNestApplication(new BunAdapter())
    await app.listen(socket)
  })

  afterAll(async () => {
    await app.close()
    await Bun.file(socket).delete()
  })

  describe('Basic HEAD handling', () => {
    it('should handle HEAD request', async () => {
      const response = await fetch('http://localhost/methods', {
        unix: socket,
        method: 'HEAD',
      })
      expect(response.status).toBe(HttpStatus.OK)
      // HEAD should not return body
      const text = await response.text()
      expect(text).toBe('')
    })

    it('should handle HEAD request with custom headers', async () => {
      const response = await fetch('http://localhost/methods/with-headers', {
        unix: socket,
        method: 'HEAD',
      })
      expect(response.status).toBe(HttpStatus.OK)
      expect(response.headers.get('x-head-header')).toBe('head-value')
      expect(response.headers.get('content-length')).toBe('42')
      // Body should be empty for HEAD
      const text = await response.text()
      expect(text).toBe('')
    })

    it('should handle HEAD request for resource with metadata', async () => {
      const response = await fetch('http://localhost/resource/456', {
        unix: socket,
        method: 'HEAD',
      })
      expect(response.status).toBe(HttpStatus.OK)
      expect(response.headers.get('x-resource-exists')).toBe('true')
      expect(response.headers.get('x-resource-type')).toBe('test')
      // Body should be empty for HEAD
      const text = await response.text()
      expect(text).toBe('')
    })

    it('should GET same endpoint return body while HEAD does not', async () => {
      // First verify GET returns body
      const getResponse = await fetch('http://localhost/methods', { unix: socket })
      const getData = (await getResponse.json()) as { method: string }
      expect(getData.method).toBe('GET')

      // Then verify HEAD returns no body
      const headResponse = await fetch('http://localhost/methods', {
        unix: socket,
        method: 'HEAD',
      })
      const headText = await headResponse.text()
      expect(headText).toBe('')
    })
  })
})
