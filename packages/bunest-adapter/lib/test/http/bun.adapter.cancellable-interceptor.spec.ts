import { CallHandler, Controller, ExecutionContext, Get, INestApplication, Injectable, NestInterceptor } from '@nestjs/common'
import { Observable, defaultIfEmpty, fromEvent, mergeMap, takeUntil } from 'rxjs'
import { Server, randomUUIDv7 } from 'bun'
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { BunAdapter } from '../../bun.adapter.js'
import { BunRequest } from '../../bun.request.js'

describe('BunAdapter Cancellable Interceptor', () => {
  class CancellableService {
    ping() { return 'pong' }

    async cleanup() {
      // Cleanup resources
    }
  }

  @Controller()
  class DummyController {
    constructor(private readonly service: CancellableService) {}

    @Get()
    async getRoot() {
      await Bun.sleep(200)
      this.service.ping() // This should not be called if request is cancelled
      return { message: 'Hello, World!' }
    }
  }

  @Injectable()
  class CancellableInterceptor implements NestInterceptor {
    constructor(private readonly service: CancellableService) {}

    public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
      const request = context.switchToHttp().getRequest<BunRequest>()
      const signal = request.signal
      const close$ = fromEvent(signal, 'abort')
      const onClosed = mergeMap(async () => {
        await this.service.cleanup()
      })

      return next.handle().pipe(takeUntil(close$.pipe(onClosed)), defaultIfEmpty(null))
    }
  }

  const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
  let app: INestApplication<Server<unknown>>
  let cancellableService: CancellableService

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DummyController],
      providers: [CancellableService, {
        provide: APP_INTERCEPTOR,
        useClass: CancellableInterceptor,
      }],
    }).compile()
    app = moduleRef.createNestApplication(new BunAdapter())
    cancellableService = moduleRef.get<CancellableService>(CancellableService)
    await app.listen(socket)
  })

  it.serial('should cancel request and invoke cleanup on abort', async () => {
    const pingSpy = spyOn(cancellableService, 'ping')
    const cleanupSpy = spyOn(cancellableService, 'cleanup')

    const abortController = new AbortController()
    const fetchPromise = fetch(`http://localhost/`, {
      unix: socket,
      signal: abortController.signal,
    })

    // Abort the request after a short delay
    setTimeout(() => {
      abortController.abort()
    }, 100)

    expect(fetchPromise).rejects.toThrowError()
    // Wait a bit for cleanup to be called
    await Bun.sleep(50)
    expect(pingSpy).not.toHaveBeenCalled()
    expect(cleanupSpy).toHaveBeenCalled()
  })

  it.serial('should complete request if not aborted', async () => {
    const pingSpy = spyOn(cancellableService, 'ping')
    const cleanupSpy = spyOn(cancellableService, 'cleanup')

    const response = await fetch(`http://localhost/`, {
      unix: socket,
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual({ message: 'Hello, World!' })
    expect(pingSpy).toHaveBeenCalled()
    expect(cleanupSpy).not.toHaveBeenCalled()
  }, { timeout: 1000 })

  afterEach(async () => {
    await app.close()
    await Bun.file(socket).delete()
  })
})
