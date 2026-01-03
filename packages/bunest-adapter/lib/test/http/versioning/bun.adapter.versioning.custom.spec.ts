/* eslint-disable sonarjs/no-alphabetical-sort */
/* eslint-disable sonarjs/no-nested-functions */
/* eslint-disable sonarjs/function-return-type */
import {
  Controller,
  Get,
  HttpStatus,
  INestApplication,
  VersioningType,
} from '@nestjs/common'
import { Server, randomUUIDv7 } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Test } from '@nestjs/testing'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  CatsControllerV1,
  CatsControllerV2,
  CustomControllerV1,
  CustomControllerV2,
  CustomControllerV2_1,
} from './versioning.controllers.js'
import { BunAdapter } from '../../../bun.adapter.js'
import { BunRequest } from '../../../bun.request.js'

describe('BunAdapter Custom Versioning', () => {
  describe('Basic custom versioning', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [CustomControllerV1, CustomControllerV2, CustomControllerV2_1],
      }).compile()

      app = moduleRef.createNestApplication(new BunAdapter())
      app.enableVersioning({
        type: VersioningType.CUSTOM,
        extractor: (request: unknown) => {
          const req = request as BunRequest
          const customHeader = req.headers['x-custom-version'] as string | undefined
          if (!customHeader) return ''
          // Support comma-separated versions, return sorted descending
          return customHeader
            .split(',')
            .map(v => v.trim())
            .filter(v => !!v)
            .sort()
            .reverse()
        },
      })
      await app.listen(socket)
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })

    it('should extract single version from header', async () => {
      const response = await fetch(`http://localhost/custom`, {
        unix: socket,
        headers: {
          'X-Custom-Version': '1.0.0',
        },
      })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { version: string, message: string }
      expect(data.version).toBe('1.0.0')
    })

    it('should extract v2.0.0 from header', async () => {
      const response = await fetch(`http://localhost/custom`, {
        unix: socket,
        headers: {
          'X-Custom-Version': '2.0.0',
        },
      })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { version: string, message: string }
      expect(data.version).toBe('2.0.0')
    })

    it('should return 404 for non-existent version', async () => {
      const response = await fetch(`http://localhost/custom`, {
        unix: socket,
        headers: {
          'X-Custom-Version': '99.0.0',
        },
      })
      expect(response.status).toBe(HttpStatus.NOT_FOUND)
    })

    describe('Multiple versions in request', () => {
      it('should select highest matching version (2.1.0)', async () => {
        const response = await fetch(`http://localhost/custom`, {
          unix: socket,
          headers: {
            'X-Custom-Version': '1.0.0,2.0.0,2.1.0',
          },
        })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { version: string }
        expect(data.version).toBe('2.1.0')
      })

      it('should select highest matching version (2.0.0) when 2.1.0 not requested', async () => {
        const response = await fetch(`http://localhost/custom`, {
          unix: socket,
          headers: {
            'X-Custom-Version': '1.0.0,2.0.0',
          },
        })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { version: string }
        expect(data.version).toBe('2.0.0')
      })

      it('should fallback to lower version when highest not available', async () => {
        const response = await fetch(`http://localhost/custom`, {
          unix: socket,
          headers: {
            'X-Custom-Version': '1.0.0,3.0.0',
          },
        })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { version: string }
        expect(data.version).toBe('1.0.0')
      })
    })
  })

  describe('Custom Versioning from query parameter', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [CatsControllerV1, CatsControllerV2],
      }).compile()

      app = moduleRef.createNestApplication(new BunAdapter())
      app.enableVersioning({
        type: VersioningType.CUSTOM,
        extractor: (request: unknown) => {
          const req = request as BunRequest
          const url = new URL(req.original().url)
          return url.searchParams.get('version') ?? ''
        },
      })
      await app.listen(socket)
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })

    it('should extract version from query parameter', async () => {
      const response = await fetch(`http://localhost/cats?version=1`, { unix: socket })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { version: string }
      expect(data.version).toBe('1')
    })

    it('should extract v2 from query parameter', async () => {
      const response = await fetch(`http://localhost/cats?version=2`, { unix: socket })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { version: string }
      expect(data.version).toBe('2')
    })

    it('should return 404 when no version query param', async () => {
      const response = await fetch(`http://localhost/cats`, { unix: socket })
      expect(response.status).toBe(HttpStatus.NOT_FOUND)
    })
  })

  describe('Single string version (non-array)', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    @Controller({
      path: 'single',
      version: '1.0.0', // Single string, not array
    })
    class SingleVersionController {
      @Get()
      get() {
        return { version: '1.0.0', type: 'single' }
      }
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [SingleVersionController],
      }).compile()

      app = moduleRef.createNestApplication(new BunAdapter())
      app.enableVersioning({
        type: VersioningType.CUSTOM,
        extractor: (request: unknown) => {
          const req = request as BunRequest
          const customHeader = req.headers['x-version'] as string | undefined
          return customHeader ?? ''
        },
      })
      await app.listen(socket)
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })

    it('should match single string version', async () => {
      const response = await fetch(`http://localhost/single`, {
        unix: socket,
        headers: {
          'X-Version': '1.0.0',
        },
      })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { version: string, type: string }
      expect(data.version).toBe('1.0.0')
      expect(data.type).toBe('single')
    })

    it('should not match different version', async () => {
      const response = await fetch(`http://localhost/single`, {
        unix: socket,
        headers: {
          'X-Version': '2.0.0',
        },
      })
      expect(response.status).toBe(HttpStatus.NOT_FOUND)
    })
  })

  describe('Special characters in version', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    @Controller({
      path: 'special',
      version: 'v1.0-beta',
    })
    class SpecialVersionController {
      @Get()
      get() {
        return { version: 'v1.0-beta' }
      }
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [SpecialVersionController],
      }).compile()

      app = moduleRef.createNestApplication(new BunAdapter())
      app.enableVersioning({
        type: VersioningType.HEADER,
        header: 'X-API-Version',
      })
      await app.listen(socket)
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })

    it('should handle version with special characters', async () => {
      const response = await fetch(`http://localhost/special`, {
        unix: socket,
        headers: {
          'X-API-Version': 'v1.0-beta',
        },
      })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { version: string }
      expect(data.version).toBe('v1.0-beta')
    })
  })
})
