import {
  Controller,
  Get,
  HttpStatus,
  INestApplication,
  Res,
  StreamableFile,
} from '@nestjs/common'
import { Server, randomUUIDv7 } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Test } from '@nestjs/testing'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { BunAdapter } from '../../bun.adapter.js'
import { BunResponse } from '../../bun.response.js'

// ================================
// Test Controllers
// ================================

@Controller('response')
class ResponseTestController {
  @Get('cookie-simple')
  setCookieSimple(@Res() res: BunResponse) {
    res.cookie('session', 'abc123')
    res.end({ message: 'Cookie set' })
  }

  @Get('cookie-options')
  setCookieWithOptions(@Res() res: BunResponse) {
    res.cookie({
      name: 'auth',
      value: 'token123',
      httpOnly: true,
      secure: true,
      maxAge: 3600,
      path: '/',
      sameSite: 'strict',
    })
    res.end({ message: 'Cookie with options set' })
  }

  @Get('delete-cookie-name')
  deleteCookieByName(@Res() res: BunResponse) {
    res.cookie('to-delete', 'value')
    res.deleteCookie({ name: 'to-delete' })
    res.end({ message: 'Cookie deleted by name' })
  }

  @Get('delete-cookie-options')
  deleteCookieWithOptions(@Res() res: BunResponse) {
    res.cookie('auth', 'token')
    res.deleteCookie('auth', { path: '/', domain: 'localhost' })
    res.end({ message: 'Cookie deleted with options' })
  }

  @Get('delete-cookie-object')
  deleteCookieByObject(@Res() res: BunResponse) {
    res.cookie('session', 'value')
    res.deleteCookie({ name: 'session', path: '/' })
    res.end({ message: 'Cookie deleted by object' })
  }

  @Get('redirect')
  doRedirect(@Res() res: BunResponse) {
    res.redirect('/response/redirect-target')
  }

  @Get('redirect-custom-status')
  doRedirectCustomStatus(@Res() res: BunResponse) {
    res.redirect('/response/redirect-target', 301)
  }

  @Get('redirect-target')
  redirectTarget() {
    return { message: 'Redirect target reached' }
  }

  @Get('status')
  setStatus(@Res() res: BunResponse) {
    res.setStatus(HttpStatus.CREATED)
    res.end({ message: 'Status set to 201' })
  }

  @Get('get-status')
  getStatus(@Res() res: BunResponse) {
    res.setStatus(HttpStatus.ACCEPTED)
    res.end({ status: res.getStatus() })
  }

  @Get('headers')
  setHeaders(@Res() res: BunResponse) {
    res.setHeader('X-Custom-Header', 'custom-value')
    res.setHeader('X-Another-Header', 'another-value')
    res.end({ message: 'Headers set' })
  }

  @Get('get-header')
  getHeader(@Res() res: BunResponse) {
    res.setHeader('X-Test-Header', 'test-value')
    res.end({
      header: res.getHeader('x-test-header'),
      missingHeader: res.getHeader('x-missing-header'),
    })
  }

  @Get('append-header')
  appendHeader(@Res() res: BunResponse) {
    res.setHeader('X-Multi', 'first')
    res.appendHeader('X-Multi', 'second')
    res.appendHeader('X-Multi', 'third')
    res.end({ message: 'Headers appended' })
  }

  @Get('append-new-header')
  appendNewHeader(@Res() res: BunResponse) {
    res.appendHeader('X-New-Header', 'value')
    res.end({ message: 'New header appended' })
  }

  @Get('remove-header')
  removeHeader(@Res() res: BunResponse) {
    res.setHeader('X-To-Remove', 'value')
    res.removeHeader('X-To-Remove')
    res.end({
      header: res.getHeader('x-to-remove'),
    })
  }

  @Get('is-ended')
  isEnded(@Res() res: BunResponse) {
    const beforeEnd = res.isEnded()
    res.end({ beforeEnd })
    // This won't actually add to response since already ended
    const afterEnd = res.isEnded()
    return { afterEnd }
  }

  @Get('double-end')
  doubleEnd(@Res() res: BunResponse) {
    res.end({ first: true })
    res.end({ second: true }) // Should be ignored
    // Return won't do anything
    return { third: true }
  }

  @Get('end-null')
  endNull(@Res() res: BunResponse) {
    res.end(null)
  }

  @Get('end-undefined')
  endUndefined(@Res() res: BunResponse) {
    res.end()
  }

  @Get('end-string')
  endString(@Res() res: BunResponse) {
    res.end('Plain string response')
  }

  @Get('end-number')
  endNumber(@Res() res: BunResponse) {
    res.end(42)
  }

  @Get('end-boolean')
  endBoolean(@Res() res: BunResponse) {
    res.end(true)
  }

  @Get('end-uint8array')
  endUint8Array(@Res() res: BunResponse) {
    const data = new TextEncoder().encode('Binary data')
    res.end(data)
  }

  @Get('end-streamable')
  endStreamable(@Res() res: BunResponse) {
    const buffer = new TextEncoder().encode('Streamable content')
    const streamable = new StreamableFile(buffer, {
      type: 'text/plain',
      disposition: 'attachment; filename="test.txt"',
      length: buffer.byteLength,
    })
    res.end(streamable)
  }

  @Get('end-streamable-no-headers')
  endStreamableNoHeaders(@Res() res: BunResponse) {
    const buffer = new TextEncoder().encode('Streamable without headers')
    const streamable = new StreamableFile(buffer)
    res.end(streamable)
  }

  @Get('end-streamable-custom-headers')
  endStreamableCustomHeaders(@Res() res: BunResponse) {
    const buffer = new TextEncoder().encode('Streamable with preset headers')
    const streamable = new StreamableFile(buffer, {
      type: 'application/octet-stream',
      disposition: 'inline',
      length: buffer.byteLength,
    })
    // Preset headers should not be overwritten
    res.setHeader('Content-Type', 'text/html')
    res.setHeader('Content-Disposition', 'attachment')
    res.setHeader('Content-Length', '999')
    res.end(streamable)
  }

  @Get('json-response')
  jsonResponse(@Res() res: BunResponse) {
    res.end({ name: 'John', age: 30, nested: { key: 'value' } })
  }

  @Get('json-with-status')
  jsonWithStatus(@Res() res: BunResponse) {
    res.setStatus(HttpStatus.CREATED)
    res.end({ created: true })
  }

  @Get('json-with-headers')
  jsonWithHeaders(@Res() res: BunResponse) {
    res.setHeader('X-Custom', 'header-value')
    res.end({ hasHeaders: true })
  }

  @Get('redirect-after-end')
  redirectAfterEnd(@Res() res: BunResponse) {
    res.end({ already: 'ended' })
    res.redirect('/should-not-redirect') // Should be ignored
  }
}

// ================================
// Test Suites
// ================================

describe('BunResponse', () => {
  const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
  let app: INestApplication<Server<unknown>>

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ResponseTestController],
    }).compile()

    app = moduleRef.createNestApplication(new BunAdapter())
    await app.listen(socket)
  })

  afterAll(async () => {
    await app.close()
    await Bun.file(socket).delete()
  })

  describe('Cookies', () => {
    it('should set simple cookie', async () => {
      const response = await fetch('http://localhost/response/cookie-simple', { unix: socket })
      const data = (await response.json()) as { message: string }
      expect(data.message).toBe('Cookie set')
      expect(response.headers.get('set-cookie')).toContain('session=abc123')
    })

    it('should set cookie with options', async () => {
      const response = await fetch('http://localhost/response/cookie-options', { unix: socket })
      const data = (await response.json()) as { message: string }
      expect(data.message).toBe('Cookie with options set')
      const setCookie = response.headers.get('set-cookie')
      expect(setCookie).toContain('auth=token123')
    })

    it('should delete cookie by name', async () => {
      const response = await fetch('http://localhost/response/delete-cookie-name', { unix: socket })
      const data = (await response.json()) as { message: string }
      expect(data.message).toBe('Cookie deleted by name')
    })

    it('should delete cookie with options', async () => {
      const response = await fetch('http://localhost/response/delete-cookie-options', { unix: socket })
      const data = (await response.json()) as { message: string }
      expect(data.message).toBe('Cookie deleted with options')
    })

    it('should delete cookie by object', async () => {
      const response = await fetch('http://localhost/response/delete-cookie-object', { unix: socket })
      const data = (await response.json()) as { message: string }
      expect(data.message).toBe('Cookie deleted by object')
    })
  })

  describe('Redirects', () => {
    it('should redirect with default 302 status', async () => {
      const response = await fetch('http://localhost/response/redirect', {
        unix: socket,
        redirect: 'manual',
      })
      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe('/response/redirect-target')
    })

    it('should redirect with custom 301 status', async () => {
      const response = await fetch('http://localhost/response/redirect-custom-status', {
        unix: socket,
        redirect: 'manual',
      })
      expect(response.status).toBe(301)
      expect(response.headers.get('location')).toBe('/response/redirect-target')
    })

    it('should not redirect after response has ended', async () => {
      const response = await fetch('http://localhost/response/redirect-after-end', { unix: socket })
      const data = (await response.json()) as { already: string }
      expect(data.already).toBe('ended')
      expect(response.status).toBe(200)
    })
  })

  describe('Status Codes', () => {
    it('should set custom status code', async () => {
      const response = await fetch('http://localhost/response/status', { unix: socket })
      expect(response.status).toBe(HttpStatus.CREATED)
    })

    it('should get current status code', async () => {
      const response = await fetch('http://localhost/response/get-status', { unix: socket })
      const data = (await response.json()) as { status: number }
      expect(data.status).toBe(HttpStatus.ACCEPTED)
      expect(response.status).toBe(HttpStatus.ACCEPTED)
    })
  })

  describe('Headers', () => {
    it('should set custom headers', async () => {
      const response = await fetch('http://localhost/response/headers', { unix: socket })
      expect(response.headers.get('x-custom-header')).toBe('custom-value')
      expect(response.headers.get('x-another-header')).toBe('another-value')
    })

    it('should get header value', async () => {
      const response = await fetch('http://localhost/response/get-header', { unix: socket })
      const data = (await response.json()) as { header: string | null, missingHeader: string | null }
      expect(data.header).toBe('test-value')
      expect(data.missingHeader).toBeNull()
    })

    it('should append to existing header', async () => {
      const response = await fetch('http://localhost/response/append-header', { unix: socket })
      expect(response.headers.get('x-multi')).toBe('first, second, third')
    })

    it('should append as new header if not exists', async () => {
      const response = await fetch('http://localhost/response/append-new-header', { unix: socket })
      expect(response.headers.get('x-new-header')).toBe('value')
    })

    it('should remove header', async () => {
      const response = await fetch('http://localhost/response/remove-header', { unix: socket })
      const data = (await response.json()) as { header: string | null }
      expect(data.header).toBeNull()
      expect(response.headers.get('x-to-remove')).toBeNull()
    })
  })

  describe('Response State', () => {
    it('should track isEnded state', async () => {
      const response = await fetch('http://localhost/response/is-ended', { unix: socket })
      const data = (await response.json()) as { beforeEnd: boolean }
      expect(data.beforeEnd).toBe(false)
    })

    it('should ignore subsequent end calls', async () => {
      const response = await fetch('http://localhost/response/double-end', { unix: socket })
      const data = (await response.json()) as { first?: boolean, second?: boolean }
      expect(data.first).toBe(true)
      expect(data.second).toBeUndefined()
    })
  })

  describe('Body Types', () => {
    it('should handle null body as JSON null', async () => {
      const response = await fetch('http://localhost/response/end-null', { unix: socket })
      expect(response.status).toBe(200)
      // null body is treated as JSON (typeof null === 'object')
      const data = await response.json()
      expect(data).toBeNull()
    })

    it('should handle undefined body', async () => {
      const response = await fetch('http://localhost/response/end-undefined', { unix: socket })
      expect(response.status).toBe(200)
      const text = await response.text()
      expect(text).toBe('')
    })

    it('should handle string body', async () => {
      const response = await fetch('http://localhost/response/end-string', { unix: socket })
      const data = (await response.json()) as string
      expect(data).toBe('Plain string response')
    })

    it('should handle number body', async () => {
      const response = await fetch('http://localhost/response/end-number', { unix: socket })
      const data = (await response.json()) as number
      expect(data).toBe(42)
    })

    it('should handle boolean body', async () => {
      const response = await fetch('http://localhost/response/end-boolean', { unix: socket })
      const data = (await response.json()) as boolean
      expect(data).toBe(true)
    })

    it('should handle Uint8Array body', async () => {
      const response = await fetch('http://localhost/response/end-uint8array', { unix: socket })
      const text = await response.text()
      expect(text).toBe('Binary data')
    })

    it('should handle StreamableFile body', async () => {
      const response = await fetch('http://localhost/response/end-streamable', { unix: socket })
      expect(response.headers.get('content-type')).toBe('text/plain')
      expect(response.headers.get('content-disposition')).toBe('attachment; filename="test.txt"')
      const text = await response.text()
      expect(text).toBe('Streamable content')
    })

    it('should handle StreamableFile without headers', async () => {
      const response = await fetch('http://localhost/response/end-streamable-no-headers', { unix: socket })
      const text = await response.text()
      expect(text).toBe('Streamable without headers')
    })

    it('should preserve preset headers over StreamableFile defaults', async () => {
      const response = await fetch('http://localhost/response/end-streamable-custom-headers', { unix: socket })
      // Preset headers are preserved when StreamableFile headers aren't set
      expect(response.headers.get('content-type')).toBe('text/html')
      expect(response.headers.get('content-disposition')).toBe('attachment')
      // Content-length is updated by StreamableFile based on actual content
      const text = await response.text()
      expect(text).toBe('Streamable with preset headers')
    })

    it('should handle JSON object', async () => {
      const response = await fetch('http://localhost/response/json-response', { unix: socket })
      const data = (await response.json()) as { name: string, age: number, nested: { key: string } }
      expect(data.name).toBe('John')
      expect(data.age).toBe(30)
      expect(data.nested.key).toBe('value')
    })

    it('should handle JSON with status', async () => {
      const response = await fetch('http://localhost/response/json-with-status', { unix: socket })
      expect(response.status).toBe(HttpStatus.CREATED)
      const data = (await response.json()) as { created: boolean }
      expect(data.created).toBe(true)
    })

    it('should handle JSON with custom headers', async () => {
      const response = await fetch('http://localhost/response/json-with-headers', { unix: socket })
      expect(response.headers.get('x-custom')).toBe('header-value')
      expect(response.headers.get('content-type')).toBe('application/json')
    })
  })
})
