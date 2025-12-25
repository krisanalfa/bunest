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
  OrdersControllerV1,
  OrdersControllerV2,
} from './versioning.controllers.js'
import { BunAdapter } from '../../../bun.adapter.js'

describe('BunAdapter Media Type Versioning', () => {
  describe('Basic media type versioning', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [OrdersControllerV1, OrdersControllerV2],
      }).compile()

      app = moduleRef.createNestApplication(new BunAdapter())
      app.enableVersioning({
        type: VersioningType.MEDIA_TYPE,
        key: 'v=',
      })
      await app.listen(socket)
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })

    it('should route to v1 with Accept header', async () => {
      const response = await fetch(`http://localhost/orders`, {
        unix: socket,
        headers: {
          Accept: 'application/json;v=1',
        },
      })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { version: string, orders: unknown[] }
      expect(data.version).toBe('1')
      expect(data.orders).toHaveLength(1)
    })

    it('should route to v2 with Accept header', async () => {
      const response = await fetch(`http://localhost/orders`, {
        unix: socket,
        headers: {
          Accept: 'application/json;v=2',
        },
      })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { version: string, orders: unknown[], metadata?: unknown }
      expect(data.version).toBe('2')
      expect(data.orders).toHaveLength(1)
      expect(data.metadata).toBeDefined()
    })

    it('should return 404 for non-existent version', async () => {
      const response = await fetch(`http://localhost/orders`, {
        unix: socket,
        headers: {
          Accept: 'application/json;v=99',
        },
      })
      expect(response.status).toBe(HttpStatus.NOT_FOUND)
    })

    it('should return 404 when no version in Accept header', async () => {
      const response = await fetch(`http://localhost/orders`, {
        unix: socket,
        headers: {
          Accept: 'application/json',
        },
      })
      expect(response.status).toBe(HttpStatus.NOT_FOUND)
    })

    it('should return 404 when Accept header has no semicolon', async () => {
      const response = await fetch(`http://localhost/orders`, {
        unix: socket,
        headers: {
          Accept: 'text/html',
        },
      })
      expect(response.status).toBe(HttpStatus.NOT_FOUND)
    })

    it('should return 404 when version key not found after semicolon', async () => {
      const response = await fetch(`http://localhost/orders`, {
        unix: socket,
        headers: {
          Accept: 'application/json;charset=utf-8',
        },
      })
      expect(response.status).toBe(HttpStatus.NOT_FOUND)
    })

    describe('Accept header variations', () => {
      it('should handle Accept header with spaces', async () => {
        const response = await fetch(`http://localhost/orders`, {
          unix: socket,
          headers: {
            Accept: 'application/json; v=1',
          },
        })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { version: string }
        expect(data.version).toBe('1')
      })

      it('should handle different media types', async () => {
        const response = await fetch(`http://localhost/orders`, {
          unix: socket,
          headers: {
            Accept: 'text/plain;v=1',
          },
        })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { version: string }
        expect(data.version).toBe('1')
      })

      it('should handle wildcard media type', async () => {
        const response = await fetch(`http://localhost/orders`, {
          unix: socket,
          headers: {
            Accept: '*/*;v=2',
          },
        })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { version: string }
        expect(data.version).toBe('2')
      })
    })
  })

  describe('Media Type Versioning with custom key', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [OrdersControllerV1, OrdersControllerV2],
      }).compile()

      app = moduleRef.createNestApplication(new BunAdapter())
      app.enableVersioning({
        type: VersioningType.MEDIA_TYPE,
        key: 'version=',
      })
      await app.listen(socket)
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })

    it('should use custom key', async () => {
      const response = await fetch(`http://localhost/orders`, {
        unix: socket,
        headers: {
          Accept: 'application/json;version=1',
        },
      })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { version: string }
      expect(data.version).toBe('1')
    })

    it('should not work with default key', async () => {
      const response = await fetch(`http://localhost/orders`, {
        unix: socket,
        headers: {
          Accept: 'application/json;v=1',
        },
      })
      expect(response.status).toBe(HttpStatus.NOT_FOUND)
    })
  })

  describe('Array version support', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    @Controller({
      path: 'multi',
      version: ['1', '2'], // Array of versions
    })
    class MultiVersionController {
      @Get()
      get() {
        return { versions: ['1', '2'] }
      }
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [MultiVersionController],
      }).compile()

      app = moduleRef.createNestApplication(new BunAdapter())
      app.enableVersioning({
        type: VersioningType.MEDIA_TYPE,
        key: 'v=',
      })
      await app.listen(socket)
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })

    it('should match first version in array', async () => {
      const response = await fetch(`http://localhost/multi`, {
        unix: socket,
        headers: {
          Accept: 'application/json;v=1',
        },
      })
      expect(response.status).toBe(HttpStatus.OK)
    })

    it('should match second version in array', async () => {
      const response = await fetch(`http://localhost/multi`, {
        unix: socket,
        headers: {
          Accept: 'application/json;v=2',
        },
      })
      expect(response.status).toBe(HttpStatus.OK)
    })

    it('should not match version not in array', async () => {
      const response = await fetch(`http://localhost/multi`, {
        unix: socket,
        headers: {
          Accept: 'application/json;v=3',
        },
      })
      expect(response.status).toBe(HttpStatus.NOT_FOUND)
    })
  })

  describe('VERSION_NEUTRAL with media type versioning', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    @Controller({
      path: 'neutral',
      version: VERSION_NEUTRAL,
    })
    class NeutralController {
      @Get()
      get() {
        return { version: 'neutral', message: 'version neutral endpoint' }
      }
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [NeutralController],
      }).compile()

      app = moduleRef.createNestApplication(new BunAdapter())
      app.enableVersioning({
        type: VersioningType.MEDIA_TYPE,
        key: 'v=',
      })
      await app.listen(socket)
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })

    it('should access neutral route without version in Accept header', async () => {
      const response = await fetch(`http://localhost/neutral`, {
        unix: socket,
        headers: {
          Accept: 'application/json', // No version parameter
        },
      })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { version: string, message: string }
      expect(data.version).toBe('neutral')
    })

    it('should access neutral route with any version', async () => {
      const response = await fetch(`http://localhost/neutral`, {
        unix: socket,
        headers: {
          Accept: 'application/json;v=99',
        },
      })
      expect(response.status).toBe(HttpStatus.OK)
    })
  })

  describe('VERSION_NEUTRAL mixed with specific version', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    @Controller({
      path: 'flexible',
      version: ['1', VERSION_NEUTRAL], // Accepts both v1 AND no version
    })
    class FlexibleController {
      @Get()
      get() {
        return { message: 'accepts v1 or neutral' }
      }
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [FlexibleController],
      }).compile()

      app = moduleRef.createNestApplication(new BunAdapter())
      app.enableVersioning({
        type: VersioningType.MEDIA_TYPE,
        key: 'v=',
      })
      await app.listen(socket)
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })

    it('should access with version 1', async () => {
      const response = await fetch(`http://localhost/flexible`, {
        unix: socket,
        headers: {
          Accept: 'application/json;v=1',
        },
      })
      expect(response.status).toBe(HttpStatus.OK)
    })

    it('should access without version (neutral)', async () => {
      const response = await fetch(`http://localhost/flexible`, {
        unix: socket,
        headers: {
          Accept: 'application/json', // No version parameter
        },
      })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { message: string }
      expect(data.message).toBe('accepts v1 or neutral')
    })
  })
})
