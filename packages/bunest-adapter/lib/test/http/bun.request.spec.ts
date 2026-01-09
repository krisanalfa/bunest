/* eslint-disable @typescript-eslint/no-unnecessary-condition */
/* eslint-disable @typescript-eslint/require-await */
import { Controller, Get, INestApplication, Post, Req } from '@nestjs/common'
import { Server, randomUUIDv7 } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Test } from '@nestjs/testing'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { BunAdapter } from '../../bun.adapter.js'
import { BunRequest } from '../../bun.request.js'

// ================================
// Test Controllers
// ================================

@Controller('request')
class RequestTestController {
  @Get('hostname')
  getHostname(@Req() req: BunRequest) {
    return { hostname: req.hostname }
  }

  @Get('pathname')
  getPathname(@Req() req: BunRequest) {
    return { pathname: req.pathname }
  }

  @Get('url')
  getUrl(@Req() req: BunRequest) {
    return { url: req.url }
  }

  @Get('method')
  getMethod(@Req() req: BunRequest) {
    return { method: req.method }
  }

  @Get('params/:id')
  getParams(@Req() req: BunRequest) {
    return { params: req.params }
  }

  @Get('query')
  getQuery(@Req() req: BunRequest) {
    return { query: req.query }
  }

  @Get('headers')
  getHeaders(@Req() req: BunRequest) {
    return {
      headers: req.headers,
      customHeader: req.headers.get('x-custom-header'),
    }
  }

  @Get('settings')
  getSettings(@Req() req: BunRequest) {
    req.set('testKey', 'testValue')
    req.set('objectKey', { nested: true })
    return {
      testKey: req.get('testKey'),
      objectKey: req.get('objectKey'),
      undefinedKey: req.get('undefinedKey'),
    }
  }

  @Get('signal')
  getSignal(@Req() req: BunRequest) {
    return { hasSignal: req.signal instanceof AbortSignal }
  }

  @Get('cookies')
  getCookies(@Req() req: BunRequest) {
    return { hasCookies: req.cookies != undefined }
  }

  @Post('body')
  async postBody(@Req() req: BunRequest) {
    return { body: req.body }
  }

  @Post('raw-body')
  async postRawBody(@Req() req: BunRequest) {
    return { hasRawBody: req.rawBody !== null }
  }

  @Post('file-test')
  async postFile(@Req() req: BunRequest) {
    return {
      file: req.file ? { name: req.file.name, size: req.file.size } : null,
    }
  }

  @Post('files-test')
  async postFiles(@Req() req: BunRequest) {
    return {
      files: req.files ? req.files.map(f => ({ name: f.name, size: f.size })) : null,
    }
  }

  @Get('clone')
  getClone(@Req() req: BunRequest) {
    req.set('originalKey', 'originalValue')
    const cloned = req.clone()
    return {
      originalHostname: req.hostname,
      clonedHostname: cloned.hostname,
      originalKey: cloned.get('originalKey'),
      isSameInstance: req === cloned,
      isSameServer: req.server === cloned.server,
    }
  }

  @Post('arraybuffer')
  async postArrayBuffer(@Req() req: BunRequest) {
    const buffer = await req.arrayBuffer()
    return { bufferSize: buffer.byteLength }
  }

  @Post('blob')
  async postBlob(@Req() req: BunRequest) {
    const blob = await req.blob()
    return { blobSize: blob.size, blobType: blob.type }
  }

  @Post('bytes')
  async postBytes(@Req() req: BunRequest) {
    const bytes = await req.bytes()
    return { bytesLength: bytes.length }
  }

  @Get('event-emitter')
  getEventEmitter(@Req() req: BunRequest) {
    // Test on() method
    const onResult = req.on('test', () => { /* no-op */ })
    // Test once() method
    const onceResult = req.once('test', () => { /* no-op */ })
    // Test off() method
    const offResult = req.off('test', () => { /* no-op */ })
    // Test emit() method
    const emitResult = req.emit('test', 'data')

    return {
      onSupported: typeof req.on === 'function',
      onResult: onResult === req,
      onceSupported: typeof req.once === 'function',
      onceResult: onceResult === req,
      offSupported: typeof req.off === 'function',
      offResult: offResult === req,
      emitSupported: typeof req.emit === 'function',
      emitResult,
    }
  }

  @Get('server')
  getServer(@Req() req: BunRequest) {
    return { hasServer: !!req.server }
  }
}

// ================================
// Test Suites
// ================================

describe('BunRequest', () => {
  const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
  let app: INestApplication<Server<unknown>>

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [RequestTestController],
    }).compile()

    app = moduleRef.createNestApplication(new BunAdapter())
    await app.listen(socket)
  })

  afterAll(async () => {
    await app.close()
    await Bun.file(socket).delete()
  })

  describe('URL Parsing', () => {
    it('should extract hostname correctly', async () => {
      const response = await fetch('http://localhost/request/hostname', { unix: socket })
      const data = (await response.json()) as { hostname: string }
      expect(data.hostname).toBe('localhost')
    })

    it('should extract pathname correctly', async () => {
      const response = await fetch('http://localhost/request/pathname', { unix: socket })
      const data = (await response.json()) as { pathname: string }
      expect(data.pathname).toBe('/request/pathname')
    })

    it('should extract pathname with query string', async () => {
      const response = await fetch('http://localhost/request/pathname?foo=bar', { unix: socket })
      const data = (await response.json()) as { pathname: string }
      expect(data.pathname).toBe('/request/pathname')
    })

    it('should return full URL', async () => {
      const response = await fetch('http://localhost/request/url', { unix: socket })
      const data = (await response.json()) as { url: string }
      expect(data.url).toContain('/request/url')
    })

    it('should return correct method', async () => {
      const response = await fetch('http://localhost/request/method', { unix: socket })
      const data = (await response.json()) as { method: string }
      expect(data.method).toBe('GET')
    })
  })

  describe('Params', () => {
    it('should extract route params correctly', async () => {
      const response = await fetch('http://localhost/request/params/123', { unix: socket })
      const data = (await response.json()) as { params: Record<string, string> }
      expect(data.params.id).toBe('123')
    })
  })

  describe('Query Parsing', () => {
    it('should parse simple query string', async () => {
      const response = await fetch('http://localhost/request/query?name=john&age=30', { unix: socket })
      const data = (await response.json()) as { query: Record<string, string> }
      expect(data.query.name).toBe('john')
      expect(data.query.age).toBe('30')
    })

    it('should handle empty query string', async () => {
      const response = await fetch('http://localhost/request/query', { unix: socket })
      const data = (await response.json()) as { query: Record<string, string> }
      expect(data.query).toEqual({})
    })

    it('should parse nested query parameters', async () => {
      const response = await fetch('http://localhost/request/query?user[name]=john&user[email]=john@example.com', { unix: socket })
      const data = (await response.json()) as { query: { user: { name: string, email: string } } }
      expect(data.query.user.name).toBe('john')
      expect(data.query.user.email).toBe('john@example.com')
    })

    it('should parse array query parameters', async () => {
      const response = await fetch('http://localhost/request/query?items[]=a&items[]=b&items[]=c', { unix: socket })
      const data = (await response.json()) as { query: { items: string[] } }
      expect(data.query.items).toEqual(['a', 'b', 'c'])
    })
  })

  describe('Headers', () => {
    it('should access headers object', async () => {
      const response = await fetch('http://localhost/request/headers', {
        unix: socket,
        headers: {
          'X-Custom-Header': 'custom-value',
        },
      })
      const data = (await response.json()) as { headers: Record<string, string>, customHeader: string }
      expect(data.customHeader).toBe('custom-value')
    })

    it('should access headers case-insensitively', async () => {
      const response = await fetch('http://localhost/request/headers', {
        unix: socket,
        headers: {
          'x-custom-header': 'lower-case-value',
        },
      })
      const data = (await response.json()) as { headers: Record<string, string>, customHeader: string }
      expect(data.customHeader).toBe('lower-case-value')
    })

    it('should return null for missing headers', async () => {
      const response = await fetch('http://localhost/request/headers', { unix: socket })
      const data = (await response.json()) as { headers: Record<string, string>, customHeader: string | null }
      expect(data.customHeader).toBeNull()
    })
  })

  describe('Settings', () => {
    it('should set and get custom settings', async () => {
      const response = await fetch('http://localhost/request/settings', { unix: socket })
      const data = (await response.json()) as { testKey: string, objectKey: { nested: boolean }, undefinedKey: undefined }
      expect(data.testKey).toBe('testValue')
      expect(data.objectKey).toEqual({ nested: true })
      expect(data.undefinedKey).toBeUndefined()
    })
  })

  describe('Signal and Cookies', () => {
    it('should have access to AbortSignal', async () => {
      const response = await fetch('http://localhost/request/signal', { unix: socket })
      const data = (await response.json()) as { hasSignal: boolean }
      expect(data.hasSignal).toBe(true)
    })

    it('should have access to CookieMap', async () => {
      const response = await fetch('http://localhost/request/cookies', { unix: socket })
      const data = (await response.json()) as { hasCookies: boolean }
      expect(data.hasCookies).toBe(true)
    })
  })

  describe('Body Handling', () => {
    it('should access parsed body', async () => {
      const response = await fetch('http://localhost/request/body', {
        unix: socket,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      })
      const data = (await response.json()) as { body: { name: string } }
      expect(data.body.name).toBe('test')
    })

    // Note: Raw body is only available when explicitly enabled in body parser options
    // This test verifies the getter works, even if raw body isn't captured
    it('should have rawBody property accessible', async () => {
      const response = await fetch('http://localhost/request/raw-body', {
        unix: socket,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      })
      const data = (await response.json()) as { hasRawBody: boolean }
      // Raw body is not enabled by default, so it will be null
      expect(data.hasRawBody).toBe(false)
    })
  })

  describe('Clone', () => {
    it('should create a clone with same properties', async () => {
      const response = await fetch('http://localhost/request/clone', { unix: socket })
      const data = (await response.json()) as {
        originalHostname: string
        clonedHostname: string
        originalKey: string
        isSameInstance: boolean
        isSameServer: boolean
      }
      expect(data.originalHostname).toBe(data.clonedHostname)
      expect(data.originalKey).toBe('originalValue')
      expect(data.isSameInstance).toBe(false)
      expect(data.isSameServer).toBe(true)
    })
  })

  describe('Server Property', () => {
    it('should have access to server instance', async () => {
      const response = await fetch('http://localhost/request/server', { unix: socket })
      const data = (await response.json()) as { hasServer: boolean }
      expect(data.hasServer).toBe(true)
    })
  })

  describe('Native Request Methods', () => {
    it('should call arrayBuffer() method successfully', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5])
      const response = await fetch('http://localhost/request/arraybuffer', {
        unix: socket,
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: testData,
      })
      const data = (await response.json()) as { bufferSize: number }
      expect(data.bufferSize).toBe(5)
    })

    it('should call blob() method successfully', async () => {
      const response = await fetch('http://localhost/request/blob', {
        unix: socket,
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array([1, 2, 3, 4, 5]),
      })
      const data = (await response.json()) as { blobSize: number, blobType: string }
      expect(data.blobSize).toBe(5)
      expect(data.blobType).toBeTruthy()
    })

    it('should call bytes() method successfully', async () => {
      const testData = new Uint8Array([10, 20, 30, 40])
      const response = await fetch('http://localhost/request/bytes', {
        unix: socket,
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: testData,
      })
      const data = (await response.json()) as { bytesLength: number }
      expect(data.bytesLength).toBe(4)
    })
  })

  describe('EventEmitter compatibility', () => {
    it('should support on() method for event listeners', async () => {
      const response = await fetch('http://localhost/request/event-emitter', { unix: socket })
      const data = (await response.json()) as { onSupported: boolean, onResult: boolean }
      expect(data.onSupported).toBe(true)
      expect(data.onResult).toBe(true)
    })

    it('should support once() method for event listeners', async () => {
      const response = await fetch('http://localhost/request/event-emitter', { unix: socket })
      const data = (await response.json()) as { onceSupported: boolean, onceResult: boolean }
      expect(data.onceSupported).toBe(true)
      expect(data.onceResult).toBe(true)
    })

    it('should support off() method for event listeners', async () => {
      const response = await fetch('http://localhost/request/event-emitter', { unix: socket })
      const data = (await response.json()) as { offSupported: boolean, offResult: boolean }
      expect(data.offSupported).toBe(true)
      expect(data.offResult).toBe(true)
    })

    it('should support emit() method and return true', async () => {
      const response = await fetch('http://localhost/request/event-emitter', { unix: socket })
      const data = (await response.json()) as { emitSupported: boolean, emitResult: boolean }
      expect(data.emitSupported).toBe(true)
      expect(data.emitResult).toBe(true)
    })
  })
})

describe('BunRequest URL Edge Cases', () => {
  const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
  let app: INestApplication<Server<unknown>>

  // Controller for edge case testing
  @Controller()
  class EdgeCaseController {
    @Get()
    getRoot(@Req() req: BunRequest) {
      return {
        hostname: req.hostname,
        pathname: req.pathname,
        // Access multiple times to test caching
        hostnameAgain: req.hostname,
        pathnameAgain: req.pathname,
      }
    }

    @Get('deep/nested/path/here')
    getDeepPath(@Req() req: BunRequest) {
      return { pathname: req.pathname }
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [EdgeCaseController],
    }).compile()

    app = moduleRef.createNestApplication(new BunAdapter())
    await app.listen(socket)
  })

  afterAll(async () => {
    await app.close()
    await Bun.file(socket).delete()
  })

  it('should return / for root pathname', async () => {
    const response = await fetch('http://localhost/', { unix: socket })
    const data = (await response.json()) as { pathname: string }
    expect(data.pathname).toBe('/')
  })

  it('should cache hostname on repeated access', async () => {
    const response = await fetch('http://localhost/', { unix: socket })
    const data = (await response.json()) as { hostname: string, hostnameAgain: string }
    expect(data.hostname).toBe(data.hostnameAgain)
  })

  it('should cache pathname on repeated access', async () => {
    const response = await fetch('http://localhost/', { unix: socket })
    const data = (await response.json()) as { pathname: string, pathnameAgain: string }
    expect(data.pathname).toBe(data.pathnameAgain)
  })

  it('should handle deep nested paths', async () => {
    const response = await fetch('http://localhost/deep/nested/path/here', { unix: socket })
    const data = (await response.json()) as { pathname: string }
    expect(data.pathname).toBe('/deep/nested/path/here')
  })

  it('should handle paths with multiple query parameters', async () => {
    const response = await fetch('http://localhost/?a=1&b=2&c=3&d=4', { unix: socket })
    const data = (await response.json()) as { pathname: string }
    expect(data.pathname).toBe('/')
  })
})
