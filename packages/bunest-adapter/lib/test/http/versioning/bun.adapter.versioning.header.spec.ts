import {
  Controller,
  Get,
  HttpStatus,
  INestApplication,
  VERSION_NEUTRAL,
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
  HealthController,
  ItemsController,
  ItemsControllerV2,
  ProductsControllerNeutral,
  ProductsControllerV1,
  ProductsControllerV2,
} from './versioning.controllers.js'
import { BunAdapter } from '../../../bun.adapter.js'

describe('BunAdapter Header Versioning', () => {
  describe('Basic header versioning', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [
          ProductsControllerV1,
          ProductsControllerV2,
          ProductsControllerNeutral,
        ],
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

    it('should route to v1 with version header', async () => {
      const response = await fetch(`http://localhost/products`, {
        unix: socket,
        headers: {
          'X-API-Version': '1',
        },
      })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { version: string, products: string[] }
      expect(data.version).toBe('1')
      expect(data.products).toHaveLength(2)
    })

    it('should route to v2 with version header', async () => {
      const response = await fetch(`http://localhost/products`, {
        unix: socket,
        headers: {
          'X-API-Version': '2',
        },
      })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { version: string, products: string[] }
      expect(data.version).toBe('2')
      expect(data.products).toHaveLength(3)
    })

    it('should return 404 for non-existent version', async () => {
      const response = await fetch(`http://localhost/products`, {
        unix: socket,
        headers: {
          'X-API-Version': '99',
        },
      })
      expect(response.status).toBe(HttpStatus.NOT_FOUND)
    })

    it('should return 404 when no version header provided and no default', async () => {
      const response = await fetch(`http://localhost/products`, { unix: socket })
      expect(response.status).toBe(HttpStatus.NOT_FOUND)
    })

    it('should handle empty version header string', async () => {
      const response = await fetch(`http://localhost/products`, {
        unix: socket,
        headers: {
          'X-API-Version': '',
        },
      })
      // Empty header should be treated as no version
      expect(response.status).toBe(HttpStatus.NOT_FOUND)
    })

    it('should handle whitespace-only version header', async () => {
      const response = await fetch(`http://localhost/products`, {
        unix: socket,
        headers: {
          'X-API-Version': '   ',
        },
      })
      // Whitespace header should be treated as no version
      expect(response.status).toBe(HttpStatus.NOT_FOUND)
    })

    describe('VERSION_NEUTRAL with header versioning', () => {
      it('should access neutral route without version header', async () => {
        const response = await fetch(`http://localhost/products/status`, { unix: socket })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { status: string, version: string }
        expect(data.status).toBe('available')
        expect(data.version).toBe('neutral')
      })

      it('should access neutral route with any version header', async () => {
        const response = await fetch(`http://localhost/products/status`, {
          unix: socket,
          headers: {
            'X-API-Version': '99',
          },
        })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { status: string, version: string }
        expect(data.status).toBe('available')
        expect(data.version).toBe('neutral')
      })
    })

    describe('Case sensitivity', () => {
      it('should handle lowercase header name', async () => {
        const response = await fetch(`http://localhost/products`, {
          unix: socket,
          headers: {
            'x-api-version': '1',
          },
        })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { version: string }
        expect(data.version).toBe('1')
      })
    })
  })

  describe('Header Versioning with custom header name', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [ProductsControllerV1, ProductsControllerV2],
      }).compile()

      app = moduleRef.createNestApplication(new BunAdapter())
      app.enableVersioning({
        type: VersioningType.HEADER,
        header: 'Custom-Version-Header',
      })
      await app.listen(socket)
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })

    it('should use custom header name', async () => {
      const response = await fetch(`http://localhost/products`, {
        unix: socket,
        headers: {
          'Custom-Version-Header': '1',
        },
      })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { version: string }
      expect(data.version).toBe('1')
    })

    it('should not work with default header', async () => {
      const response = await fetch(`http://localhost/products`, {
        unix: socket,
        headers: {
          'X-API-Version': '1',
        },
      })
      expect(response.status).toBe(HttpStatus.NOT_FOUND)
    })
  })

  describe('Default Version (single)', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [ItemsController, ItemsControllerV2],
      }).compile()

      app = moduleRef.createNestApplication(new BunAdapter())
      app.enableVersioning({
        type: VersioningType.HEADER,
        header: 'X-API-Version',
        defaultVersion: '1',
      })
      await app.listen(socket)
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })

    it('should use default version when no version specified', async () => {
      const response = await fetch(`http://localhost/items`, { unix: socket })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { message: string }
      expect(data.message).toBe('Items without explicit version')
    })

    it('should override default with explicit version', async () => {
      const response = await fetch(`http://localhost/items`, {
        unix: socket,
        headers: {
          'X-API-Version': '2',
        },
      })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { version: string, message: string }
      expect(data.version).toBe('2')
    })
  })

  describe('Default Version (multiple)', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [CatsControllerV1, CatsControllerV2],
      }).compile()

      app = moduleRef.createNestApplication(new BunAdapter())
      app.enableVersioning({
        type: VersioningType.HEADER,
        header: 'X-API-Version',
        defaultVersion: ['1', '2'],
      })
      await app.listen(socket)
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })

    it('should work with any of the default versions', async () => {
      const response = await fetch(`http://localhost/cats`, { unix: socket })
      expect(response.status).toBe(HttpStatus.OK)
    })

    it('should use first matching default version from array', async () => {
      // When no version is provided, should use first default that matches handler
      const response = await fetch(`http://localhost/cats`, { unix: socket })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { version: string }
      // Should match v1 since it's first in defaults that matches
      expect(data.version).toBe('1')
    })
  })

  describe('Default Version with partial match', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [CatsControllerV2], // Only v2 controller
      }).compile()

      app = moduleRef.createNestApplication(new BunAdapter())
      app.enableVersioning({
        type: VersioningType.HEADER,
        header: 'X-API-Version',
        defaultVersion: ['3', '2', '1'], // Array with v2 matching
      })
      await app.listen(socket)
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })

    it('should find matching version in default array', async () => {
      // Handler version is '2', defaults are ['3', '2', '1']
      // Should match '2' from defaults
      const response = await fetch(`http://localhost/cats`, { unix: socket })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { version: string }
      expect(data.version).toBe('2')
    })
  })

  describe('Default Version (VERSION_NEUTRAL)', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [HealthController, CatsControllerV1],
      }).compile()

      app = moduleRef.createNestApplication(new BunAdapter())
      app.enableVersioning({
        type: VersioningType.HEADER,
        header: 'X-API-Version',
        defaultVersion: VERSION_NEUTRAL,
      })
      await app.listen(socket)
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })

    it('should access neutral controller without version header', async () => {
      const response = await fetch(`http://localhost/health`, { unix: socket })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { status: string, version: string }
      expect(data.version).toBe('neutral')
    })

    it('should still require version for non-neutral controllers', async () => {
      const response = await fetch(`http://localhost/cats`, {
        unix: socket,
        headers: {
          'X-API-Version': '1',
        },
      })
      expect(response.status).toBe(HttpStatus.OK)
    })

    it('should return 404 for versioned controller when no version provided with VERSION_NEUTRAL default', async () => {
      // CatsControllerV1 is not neutral, so it should not match
      const response = await fetch(`http://localhost/cats`, { unix: socket })
      expect(response.status).toBe(HttpStatus.NOT_FOUND)
    })
  })

  describe('VERSION_NEUTRAL mixed with specific version', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    @Controller({
      path: 'flex',
      version: ['2', VERSION_NEUTRAL], // Accepts both v2 AND no version
    })
    class FlexHeaderController {
      @Get()
      get() {
        return { version: '2', message: 'accepts v2 or neutral' }
      }
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [FlexHeaderController],
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

    it('should access with version 2', async () => {
      const response = await fetch(`http://localhost/flex`, {
        unix: socket,
        headers: {
          'X-API-Version': '2',
        },
      })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { version: string }
      expect(data.version).toBe('2')
    })

    it('should access without version header (neutral)', async () => {
      const response = await fetch(`http://localhost/flex`, { unix: socket })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { message: string }
      expect(data.message).toBe('accepts v2 or neutral')
    })
  })

  describe('Edge Cases', () => {
    describe('Empty version strings', () => {
      const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
      let app: INestApplication<Server<unknown>>

      beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
          controllers: [CatsControllerV1],
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

      it('should return 404 for empty version header', async () => {
        const response = await fetch(`http://localhost/cats`, {
          unix: socket,
          headers: {
            'X-API-Version': '',
          },
        })
        expect(response.status).toBe(HttpStatus.NOT_FOUND)
      })

      it('should return 404 for whitespace-only version header', async () => {
        const response = await fetch(`http://localhost/cats`, {
          unix: socket,
          headers: {
            'X-API-Version': '   ',
          },
        })
        expect(response.status).toBe(HttpStatus.NOT_FOUND)
      })
    })
  })
})
