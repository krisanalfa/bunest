import {
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
  BirdsController,
  CatsControllerV1,
  CatsControllerV2,
  CatsControllerV3,
  DogsControllerV1V2,
  DogsControllerV3,
  FishController,
  HealthController,
} from './versioning.controllers.js'
import { BunAdapter } from '../../../bun.adapter.js'

describe('BunAdapter URI Versioning', () => {
  describe('Basic URI versioning', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [
          CatsControllerV1,
          CatsControllerV2,
          CatsControllerV3,
          DogsControllerV1V2,
          DogsControllerV3,
          HealthController,
          BirdsController,
          FishController,
        ],
      }).compile()

      app = moduleRef.createNestApplication(new BunAdapter())
      app.enableVersioning({
        type: VersioningType.URI,
      })
      await app.listen(socket)
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })

    describe('Basic routing', () => {
      it('should route to v1 controller', async () => {
        const response = await fetch(`http://localhost/v1/cats`, { unix: socket })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { version: string, message: string }
        expect(data.version).toBe('1')
        expect(data.message).toBe('All cats from version 1')
      })

      it('should route to v2 controller', async () => {
        const response = await fetch(`http://localhost/v2/cats`, { unix: socket })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { version: string, message: string }
        expect(data.version).toBe('2')
        expect(data.message).toBe('All cats from version 2')
      })

      it('should route to v3 controller', async () => {
        const response = await fetch(`http://localhost/v3/cats`, { unix: socket })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { version: string, message: string, pagination?: boolean }
        expect(data.version).toBe('3')
        expect(data.pagination).toBe(true)
      })

      it('should return 404 for non-existent version', async () => {
        const response = await fetch(`http://localhost/v99/cats`, { unix: socket })
        expect(response.status).toBe(HttpStatus.NOT_FOUND)
      })

      it('should route nested paths correctly for v1', async () => {
        const response = await fetch(`http://localhost/v1/cats/details`, { unix: socket })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { version: string, details: string }
        expect(data.version).toBe('1')
        expect(data.details).toBe('Cat details from v1')
      })

      it('should route nested paths correctly for v2', async () => {
        const response = await fetch(`http://localhost/v2/cats/details`, { unix: socket })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { version: string, details: string }
        expect(data.version).toBe('2')
        expect(data.details).toBe('Cat details from v2 with more info')
      })
    })

    describe('Multiple versions on single controller', () => {
      it('should route v1 to multi-version controller', async () => {
        const response = await fetch(`http://localhost/v1/dogs`, { unix: socket })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { version: string, message: string }
        expect(data.version).toBe('1 or 2')
      })

      it('should route v2 to multi-version controller', async () => {
        const response = await fetch(`http://localhost/v2/dogs`, { unix: socket })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { version: string, message: string }
        expect(data.version).toBe('1 or 2')
      })

      it('should route v3 to separate controller', async () => {
        const response = await fetch(`http://localhost/v3/dogs`, { unix: socket })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { version: string, message: string }
        expect(data.version).toBe('3')
      })
    })

    describe('VERSION_NEUTRAL', () => {
      it('should access neutral version without version prefix', async () => {
        const response = await fetch(`http://localhost/health`, { unix: socket })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { status: string, version: string }
        expect(data.status).toBe('ok')
        expect(data.version).toBe('neutral')
      })

      it('should return 404 when accessing neutral route with version prefix', async () => {
        const response = await fetch(`http://localhost/v1/health`, { unix: socket })
        expect(response.status).toBe(HttpStatus.NOT_FOUND)
      })

      it('should return 404 when accessing neutral route with non-existent version prefix', async () => {
        const response = await fetch(`http://localhost/v99/health`, { unix: socket })
        expect(response.status).toBe(HttpStatus.NOT_FOUND)
      })
    })

    describe('Route-level versioning', () => {
      it('should route to v1 route handler', async () => {
        const response = await fetch(`http://localhost/v1/birds`, { unix: socket })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { version: string, message: string }
        expect(data.version).toBe('1')
        expect(data.message).toBe('Birds from version 1')
      })

      it('should route to v2 route handler', async () => {
        const response = await fetch(`http://localhost/v2/birds`, { unix: socket })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { version: string, message: string }
        expect(data.version).toBe('2')
        expect(data.message).toBe('Birds from version 2')
      })

      it('should handle multi-version route with v1', async () => {
        const response = await fetch(`http://localhost/v1/birds/multi`, { unix: socket })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { version: string, message: string }
        expect(data.version).toBe('1, 2, or 3')
      })

      it('should handle multi-version route with v2', async () => {
        const response = await fetch(`http://localhost/v2/birds/multi`, { unix: socket })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { version: string, message: string }
        expect(data.version).toBe('1, 2, or 3')
      })

      it('should handle multi-version route with v3', async () => {
        const response = await fetch(`http://localhost/v3/birds/multi`, { unix: socket })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { version: string, message: string }
        expect(data.version).toBe('1, 2, or 3')
      })

      it('should handle neutral route without version prefix', async () => {
        const response = await fetch(`http://localhost/birds/neutral`, { unix: socket })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { version: string, message: string }
        expect(data.version).toBe('neutral')
      })

      it('should return 404 for unversioned base route', async () => {
        const response = await fetch(`http://localhost/birds`, { unix: socket })
        expect(response.status).toBe(HttpStatus.NOT_FOUND)
      })
    })

    describe('Mixed controller and route versioning', () => {
      it('should use controller version for unversioned route', async () => {
        const response = await fetch(`http://localhost/v1/fish`, { unix: socket })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { version: string, message: string }
        expect(data.version).toBe('1')
        expect(data.message).toBe('Fish from controller version 1')
      })

      it('should use route version override', async () => {
        const response = await fetch(`http://localhost/v2/fish/special`, { unix: socket })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { version: string, message: string }
        expect(data.version).toBe('2')
        expect(data.message).toBe('Fish special route overridden to v2')
      })

      it('should not access overridden route with controller version', async () => {
        const response = await fetch(`http://localhost/v1/fish/special`, { unix: socket })
        expect(response.status).toBe(HttpStatus.NOT_FOUND)
      })

      it('should access neutral route without version', async () => {
        const response = await fetch(`http://localhost/fish/common`, { unix: socket })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { version: string, message: string }
        expect(data.version).toBe('neutral')
      })
    })

    describe('HTTP methods with versioning', () => {
      it('should handle POST with v1', async () => {
        const response = await fetch(`http://localhost/v1/cats`, {
          unix: socket,
          method: 'POST',
        })
        expect(response.status).toBe(HttpStatus.CREATED)
        const data = (await response.json()) as { version: string, created: boolean }
        expect(data.version).toBe('1')
        expect(data.created).toBe(true)
      })

      it('should handle POST with v2', async () => {
        const response = await fetch(`http://localhost/v2/cats`, {
          unix: socket,
          method: 'POST',
        })
        expect(response.status).toBe(HttpStatus.CREATED)
        const data = (await response.json()) as { version: string, created: boolean, enhanced?: boolean }
        expect(data.version).toBe('2')
        expect(data.created).toBe(true)
        expect(data.enhanced).toBe(true)
      })
    })

    describe('Error handling with versioning', () => {
      it('should return 404 for version prefix without path', async () => {
        const response = await fetch(`http://localhost/v1`, { unix: socket })
        expect(response.status).toBe(HttpStatus.NOT_FOUND)
      })

      it('should return 404 for mismatched version and controller', async () => {
        const response = await fetch(`http://localhost/v3/cats/details`, { unix: socket })
        expect(response.status).toBe(HttpStatus.NOT_FOUND)
      })

      it('should handle case where v0 does not exist', async () => {
        const response = await fetch(`http://localhost/v0/cats`, { unix: socket })
        expect(response.status).toBe(HttpStatus.NOT_FOUND)
      })
    })

    describe('Query parameters with versioning', () => {
      it('should preserve query parameters when routing to versioned endpoint', async () => {
        const response = await fetch(`http://localhost/v1/cats?filter=active&limit=10`, { unix: socket })
        expect(response.status).toBe(HttpStatus.OK)
        const data = (await response.json()) as { version: string }
        expect(data.version).toBe('1')
      })
    })
  })

  describe('URI Versioning with custom prefix', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [CatsControllerV1, CatsControllerV2],
      }).compile()

      app = moduleRef.createNestApplication(new BunAdapter())
      app.enableVersioning({
        type: VersioningType.URI,
        prefix: 'api/v',
      })
      await app.listen(socket)
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })

    it('should use custom prefix for v1', async () => {
      const response = await fetch(`http://localhost/api/v1/cats`, { unix: socket })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { version: string }
      expect(data.version).toBe('1')
    })

    it('should use custom prefix for v2', async () => {
      const response = await fetch(`http://localhost/api/v2/cats`, { unix: socket })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { version: string }
      expect(data.version).toBe('2')
    })

    it('should not work without custom prefix', async () => {
      const response = await fetch(`http://localhost/v1/cats`, { unix: socket })
      expect(response.status).toBe(HttpStatus.NOT_FOUND)
    })
  })

  describe('URI Versioning without prefix', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [CatsControllerV1, CatsControllerV2],
      }).compile()

      app = moduleRef.createNestApplication(new BunAdapter())
      app.enableVersioning({
        type: VersioningType.URI,
        prefix: false,
      })
      await app.listen(socket)
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })

    it('should work without any prefix for v1', async () => {
      const response = await fetch(`http://localhost/1/cats`, { unix: socket })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { version: string }
      expect(data.version).toBe('1')
    })

    it('should work without any prefix for v2', async () => {
      const response = await fetch(`http://localhost/2/cats`, { unix: socket })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { version: string }
      expect(data.version).toBe('2')
    })
  })

  describe('URI Versioning with Global Prefix', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [CatsControllerV1, CatsControllerV2],
      }).compile()

      app = moduleRef.createNestApplication(new BunAdapter())
      app.setGlobalPrefix('api')
      app.enableVersioning({
        type: VersioningType.URI,
      })
      await app.listen(socket)
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })

    it('should include version after global prefix', async () => {
      const response = await fetch(`http://localhost/api/v1/cats`, { unix: socket })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { version: string }
      expect(data.version).toBe('1')
    })

    it('should work with v2 and global prefix', async () => {
      const response = await fetch(`http://localhost/api/v2/cats`, { unix: socket })
      expect(response.status).toBe(HttpStatus.OK)
      const data = (await response.json()) as { version: string }
      expect(data.version).toBe('2')
    })

    it('should return 404 without global prefix', async () => {
      const response = await fetch(`http://localhost/v1/cats`, { unix: socket })
      expect(response.status).toBe(HttpStatus.NOT_FOUND)
    })
  })

  describe('Concurrent requests to different versions', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [CatsControllerV1, CatsControllerV2, CatsControllerV3],
      }).compile()

      app = moduleRef.createNestApplication(new BunAdapter())
      app.enableVersioning({
        type: VersioningType.URI,
      })
      await app.listen(socket)
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })

    it('should handle concurrent requests to different versions', async () => {
      const requests = [
        fetch(`http://localhost/v1/cats`, { unix: socket }),
        fetch(`http://localhost/v2/cats`, { unix: socket }),
        fetch(`http://localhost/v3/cats`, { unix: socket }),
        fetch(`http://localhost/v1/cats`, { unix: socket }),
        fetch(`http://localhost/v2/cats`, { unix: socket }),
      ]

      const responses = await Promise.all(requests)

      expect(responses[0].status).toBe(HttpStatus.OK)
      expect(responses[1].status).toBe(HttpStatus.OK)
      expect(responses[2].status).toBe(HttpStatus.OK)
      expect(responses[3].status).toBe(HttpStatus.OK)
      expect(responses[4].status).toBe(HttpStatus.OK)

      const data = await Promise.all(
        responses.map(r => r.json() as Promise<{ version: string }>),
      )

      expect(data[0].version).toBe('1')
      expect(data[1].version).toBe('2')
      expect(data[2].version).toBe('3')
      expect(data[3].version).toBe('1')
      expect(data[4].version).toBe('2')
    })
  })
})
