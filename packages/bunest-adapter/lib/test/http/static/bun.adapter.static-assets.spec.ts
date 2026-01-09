import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Test } from '@nestjs/testing'
import { join } from 'path'
import { randomUUIDv7 } from 'bun'
import { tmpdir } from 'os'

import { BunAdapter } from '../../../bun.adapter.js'
import { NestBunApplication } from '../../..//bun.internal.types.js'

describe('BunAdapter Serve-Static Assets', () => {
  describe('Static Routes', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: NestBunApplication

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        //
      }).compile()
      app = moduleRef.createNestApplication<NestBunApplication>(new BunAdapter())
      app.useStaticAssets(join(__dirname, 'assets'), { useStatic: true })
      await app.listen(socket)
    })

    it('should serve static asset (root)', async () => {
      const response = await fetch('http://localhost/root.json', { unix: socket })
      expect(response.status).toBe(200)
      const data = await response.json() as { root: boolean }
      expect(data).toEqual({ root: true })
      const etag = response.headers.get('etag')
      expect(etag).toBeDefined()
      expect(etag).not.toBeNull()

      // check caching with if-none-match
      const cachedResponse = await fetch('http://localhost/root.json', {
        unix: socket,
        headers: {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          'if-none-match': etag!,
        },
      })
      expect(cachedResponse.status).toBe(304)
      // body should be empty
      const body = await cachedResponse.text()
      expect(body).toBe('')

      // check older if-modified-since returns 200
      const olderDate = new Date(Date.now() - 1000 * 60 * 60).toUTCString()
      const olderResponse = await fetch('http://localhost/root.json', {
        unix: socket,
        headers: {
          'if-modified-since': olderDate,
        },
      })
      expect(olderResponse.status).toBe(200)
      // body should be present
      const olderBody = await olderResponse.json() as { root: boolean }
      expect(olderBody).toEqual({ root: true })
    })

    it('should serve static asset (child)', async () => {
      const response = await fetch('http://localhost/child/child.json', { unix: socket })
      expect(response.status).toBe(200)
      const data = await response.json() as { child: boolean }
      expect(data).toEqual({ child: true })
    })

    it('should serve static asset (grandchild)', async () => {
      const response = await fetch('http://localhost/child/grandchild/grandchild.json', { unix: socket })
      expect(response.status).toBe(200)
      const data = await response.json() as { grandchild: boolean }
      expect(data).toEqual({ grandchild: true })
    })

    it('should return 404 for non-existing asset', async () => {
      const response = await fetch('http://localhost/non-existing.json', { unix: socket })
      expect(response.status).toBe(404)
    })

    describe('should return correct content-type headers', () => {
      it('should return application/json for .json files', async () => {
        const response = await fetch('http://localhost/root.json', { unix: socket })
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toContain('application/json')
      })

      it('should return text/plain for .txt files', async () => {
        const response = await fetch('http://localhost/root.txt', { unix: socket })
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toContain('text/plain')
      })

      it('should return text/css for .css files', async () => {
        const response = await fetch('http://localhost/root.css', { unix: socket })
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toContain('text/css')
      })

      it('should return application/javascript for .js files', async () => {
        const response = await fetch('http://localhost/root.js', { unix: socket })
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toContain('text/javascript')
      })

      it('should return text/html for .html files', async () => {
        const response = await fetch('http://localhost/root.html', { unix: socket })
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toContain('text/html')
      })
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })
  })

  describe('File Routes', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: NestBunApplication

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        //
      }).compile()
      app = moduleRef.createNestApplication<NestBunApplication>(new BunAdapter(), { cors: true })
      app.useStaticAssets(join(__dirname, 'assets'), { useStatic: false })
      // create dummy file before listen
      await Bun.write(join(__dirname, 'assets', 'dummy.txt'), 'dummy')
      await app.listen(socket)
    })

    it('should serve static asset (root)', async () => {
      const response = await fetch('http://localhost/root.json', { unix: socket })
      expect(response.status).toBe(200)
      const data = await response.json() as { root: boolean }
      expect(data).toEqual({ root: true })
      // check cors header
      expect(response.headers.get('access-control-allow-origin')).toBe('*')

      // check caching with if-modified-since
      const cachedResponse = await fetch('http://localhost/root.json', {
        unix: socket,
        headers: {
          'if-modified-since': new Date().toUTCString(),
        },
      })
      expect(cachedResponse.status).toBe(304)
      // body should be empty
      const body = await cachedResponse.text()
      expect(body).toBe('')
      // cors header should still be present
      expect(cachedResponse.headers.get('access-control-allow-origin')).toBe('*')
    })

    it('should serve static asset (child)', async () => {
      const response = await fetch('http://localhost/child/child.json', { unix: socket })
      expect(response.status).toBe(200)
      const data = await response.json() as { child: boolean }
      expect(data).toEqual({ child: true })
    })

    it('should serve static asset (grandchild)', async () => {
      const response = await fetch('http://localhost/child/grandchild/grandchild.json', { unix: socket })
      expect(response.status).toBe(200)
      const data = await response.json() as { grandchild: boolean }
      expect(data).toEqual({ grandchild: true })
    })

    it('should return 404 for non-existing asset', async () => {
      const response = await fetch('http://localhost/non-existing.json', { unix: socket })
      expect(response.status).toBe(404)
      const body = await response.json() as { statusCode: number, message: string, error: string }
      expect(body).toEqual({ statusCode: 404, message: 'Cannot GET /non-existing.json', error: 'Not Found' })
      // cors header should still be present
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
    })

    it('should serve dummy.txt file', async () => {
      const response = await fetch('http://localhost/dummy.txt', { unix: socket })
      expect(response.status).toBe(200)
      const text = await response.text()
      expect(text).toBe('dummy')

      // Delete the dummy file after test
      await Bun.file(join(__dirname, 'assets', 'dummy.txt')).delete()
      // Accessing it again should return 404
      const responseAfterDelete = await fetch('http://localhost/dummy.txt', { unix: socket })
      expect(responseAfterDelete.status).toBe(404)
      const body = await responseAfterDelete.json() as { statusCode: number, message: string, error: string }
      expect(body).toEqual({ statusCode: 404, message: 'Cannot GET /dummy.txt', error: 'Not Found' })
      // cors header should still be present
      expect(responseAfterDelete.headers.get('access-control-allow-origin')).toBe('*')
    })

    describe('should handle requests with "Range" header', () => {
      it ('should return partial content using range header with explicit end', async () => {
        const response = await fetch('http://localhost/root.json', {
          unix: socket,
          headers: {
            Range: 'bytes=0-10',
          },
        })
        expect(response.status).toBe(206)
        const text = await response.text()
        expect(text).toBe('{"root": tr')
        expect(response.headers.get('content-range')).toBe('bytes 0-10/14')
        // cors header should still be present
        expect(response.headers.get('access-control-allow-origin')).toBe('*')
      })

      it ('should return partial content using range header without explicit end', async () => {
        const response = await fetch('http://localhost/root.json', {
          unix: socket,
          headers: {
            Range: 'bytes=8-',
          },
        })
        expect(response.status).toBe(206)
        const text = await response.text()
        expect(text).toBe(' true}')
        expect(response.headers.get('content-range')).toBe('bytes 8-13/14')
        // cors header should still be present
        expect(response.headers.get('access-control-allow-origin')).toBe('*')
      })

      it('should return 416 for invalid range', async () => {
        const response = await fetch('http://localhost/root.json', {
          unix: socket,
          headers: {
            Range: 'bytes=20-30',
          },
        })
        expect(response.status).toBe(416)
        // body should be empty
        const body = await response.text()
        expect(body).toBe('')
        // cors header should still be present
        expect(response.headers.get('access-control-allow-origin')).toBe('*')
      })

      it('should be able to combine partial content using multiple requests', async () => {
        const part1 = await fetch('http://localhost/root.json', {
          unix: socket,
          headers: {
            Range: 'bytes=0-6',
          },
        })
        const text1 = await part1.text()

        const part2 = await fetch('http://localhost/root.json', {
          unix: socket,
          headers: {
            Range: 'bytes=7-13',
          },
        })
        const text2 = await part2.text()

        const combined = text1 + text2
        expect(JSON.parse(combined)).toEqual({ root: true })
      })
    })

    describe('should return correct content-type headers', () => {
      it('should return application/json for .json files', async () => {
        const response = await fetch('http://localhost/root.json', { unix: socket })
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toContain('application/json')
      })

      it('should return text/plain for .txt files', async () => {
        const response = await fetch('http://localhost/root.txt', { unix: socket })
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toContain('text/plain')
      })

      it('should return text/css for .css files', async () => {
        const response = await fetch('http://localhost/root.css', { unix: socket })
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toContain('text/css')
      })

      it('should return application/javascript for .js files', async () => {
        const response = await fetch('http://localhost/root.js', { unix: socket })
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toContain('text/javascript')
      })

      it('should return text/html for .html files', async () => {
        const response = await fetch('http://localhost/root.html', { unix: socket })
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toContain('text/html')
      })
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
      // Delete dummy file after tests
      try {
        await Bun.file(join(__dirname, 'assets', 'dummy.txt')).delete()
      }
      catch {
        // noop
      }
    })
  })
})
