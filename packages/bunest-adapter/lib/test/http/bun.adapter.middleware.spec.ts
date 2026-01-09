import {
  Controller,
  Get,
  INestApplication,
  Inject,
  MiddlewareConsumer,
  Module,
  NestMiddleware,
  NestModule,
  RequestMethod,
  VersioningType,
} from '@nestjs/common'
import { Server, randomUUIDv7 } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { REQUEST } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { BunAdapter } from '../../bun.adapter.js'
import { BunRequest } from '../../bun.request.js'
import { BunResponse } from '../../bun.response.js'

@Controller('/dummy')
class DummyController {
  constructor(
    @Inject(REQUEST)
    private readonly request: BunRequest,
  ) {}

  @Get()
  getDummy() {
    return {
      message: 'Hello, Bun!',
      dummyProperty: this.request.get('dummyProperty'),
      globalProperty: this.request.get('globalProperty'),
    }
  }

  @Get('dont-skip')
  getDontSkip() {
    return {
      message: 'This route does not skip the middleware.',
      dummyProperty: this.request.get('dummyProperty'),
      globalProperty: this.request.get('globalProperty'),
    }
  }

  @Get('skip')
  getSkip() {
    return {
      message: 'This route skips the middleware.',
      dummyProperty: this.request.get('dummyProperty'),
      globalProperty: this.request.get('globalProperty'),
    }
  }
}

@Controller('/another-dummy')
class AnotherDummyController {
  constructor(
    @Inject(REQUEST)
    private readonly request: BunRequest,
  ) {}

  @Get()
  getAnotherDummy() {
    return {
      message: 'Another Dummy!',
      globalProperty: this.request.get('globalProperty'),
    }
  }
}

class DummyMiddleware implements NestMiddleware<BunRequest, BunResponse> {
  use(req: BunRequest, res: BunResponse, next: () => void) {
    req.set('dummyProperty', 'dummyValue')
    next()
  }
}

class GlobalMiddleware implements NestMiddleware<BunRequest, BunResponse> {
  use(req: BunRequest, res: BunResponse, next: () => void) {
    req.set('globalProperty', 'globalValue')
    next()
  }
}

@Module({
  controllers: [DummyController, AnotherDummyController],
  providers: [DummyMiddleware],
})
class DummyModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(DummyMiddleware)
      .exclude({
        path: '/dummy/skip',
        method: RequestMethod.GET,
      }, {
        path: '/dummy/dont-skip',
        method: RequestMethod.POST, // We have 'GET' setup for this route, so the middleware should run on our Controller
      })
      .forRoutes(DummyController)
    consumer.apply(GlobalMiddleware).forRoutes('*')
  }
}

describe('BunAdapter Middleware', () => {
  const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
  let app: INestApplication<Server<unknown>>

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DummyModule],
    }).compile()

    app = moduleRef.createNestApplication(new BunAdapter())
    await app.listen(socket)
  })

  describe('DummyMiddleware', () => {
    it('should add dummyProperty to the request object', async () => {
      const response = await fetch(
        `http://localhost/dummy`,
        { unix: socket },
      )
      const data = await response.json() as { message: string, dummyProperty: string, globalProperty: string }
      expect(data).toEqual({
        message: 'Hello, Bun!',
        dummyProperty: 'dummyValue',
        globalProperty: 'globalValue',
      })
    })

    it('should skip middleware for excluded route', async () => {
      const response = await fetch(
        `http://localhost/dummy/skip`,
        { unix: socket },
      )
      const data = await response.json() as { message: string, dummyProperty: unknown, globalProperty: string }
      expect(data).toEqual({
        message: 'This route skips the middleware.',
        dummyProperty: undefined,
        globalProperty: 'globalValue',
      })
    })

    it('should apply global middleware to all routes', async () => {
      const response = await fetch(
        `http://localhost/another-dummy`,
        { unix: socket },
      )
      const data = await response.json() as { message: string, globalProperty: string }
      expect(data).toEqual({
        message: 'Another Dummy!',
        globalProperty: 'globalValue',
      })
    })

    it('should not skip middleware for non-method-matched route', async () => {
      const response = await fetch(
        `http://localhost/dummy/dont-skip`,
        { unix: socket },
      )
      const data = await response.json() as { message: string, dummyProperty: string, globalProperty: string }
      expect(data).toEqual({
        message: 'This route does not skip the middleware.',
        dummyProperty: 'dummyValue',
        globalProperty: 'globalValue',
      })
    })
  })

  afterAll(async () => {
    await app.close()
    await Bun.file(socket).delete()
  })
})

// ================================
// Middleware Versioning Tests
// ================================

@Controller({
  path: 'versioned-cats',
  version: '1',
})
class VersionedCatsControllerV1 {
  constructor(
    @Inject(REQUEST)
    private readonly request: BunRequest,
  ) {}

  @Get()
  findAll() {
    return {
      version: '1',
      message: 'All cats from version 1',
      loggerApplied: this.request.get('loggerApplied'),
    }
  }
}

@Controller({
  path: 'versioned-cats',
  version: '2',
})
class VersionedCatsControllerV2 {
  constructor(
    @Inject(REQUEST)
    private readonly request: BunRequest,
  ) {}

  @Get()
  findAll() {
    return {
      version: '2',
      message: 'All cats from version 2',
      loggerApplied: this.request.get('loggerApplied'),
    }
  }
}

class VersionedLoggerMiddleware implements NestMiddleware<BunRequest, BunResponse> {
  use(req: BunRequest, res: BunResponse, next: () => void) {
    req.set('loggerApplied', true)
    next()
  }
}

@Module({
  controllers: [VersionedCatsControllerV1, VersionedCatsControllerV2],
})
class VersionedCatsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply middleware only to version 2 of the cats route
    consumer
      .apply(VersionedLoggerMiddleware)
      .forRoutes({ path: 'versioned-cats', method: RequestMethod.GET, version: '2' })
  }
}

describe('BunAdapter Middleware Versioning', () => {
  const socket2 = join(tmpdir(), `${randomUUIDv7()}.sock`)
  let app: INestApplication<Server<unknown>>

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [VersionedCatsModule],
    }).compile()

    app = moduleRef.createNestApplication(new BunAdapter())
    app.enableVersioning({
      type: VersioningType.URI,
    })
    await app.listen(socket2)
  })

  afterAll(async () => {
    await app.close()
    await Bun.file(socket2).delete()
  })

  describe('Version-specific middleware', () => {
    it('should NOT apply middleware to version 1 route', async () => {
      const response = await fetch(
        `http://localhost/v1/versioned-cats`,
        { unix: socket2 },
      )
      expect(response.status).toBe(200)
      const data = await response.json() as { version: string, message: string, loggerApplied: unknown }
      expect(data).toEqual({
        version: '1',
        message: 'All cats from version 1',
        loggerApplied: undefined,
      })
    })

    it('should apply middleware to version 2 route', async () => {
      const response = await fetch(
        `http://localhost/v2/versioned-cats`,
        { unix: socket2 },
      )
      expect(response.status).toBe(200)
      const data = await response.json() as { version: string, message: string, loggerApplied: boolean }
      expect(data).toEqual({
        version: '2',
        message: 'All cats from version 2',
        loggerApplied: true,
      })
    })
  })
})
