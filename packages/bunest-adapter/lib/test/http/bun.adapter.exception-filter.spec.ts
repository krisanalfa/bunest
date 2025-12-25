import { ArgumentsHost, Catch, Controller, ExceptionFilter, Get, HttpException, INestApplication } from '@nestjs/common'
import { Server, randomUUIDv7 } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Test } from '@nestjs/testing'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { BunAdapter } from '../../bun.adapter.js'
import { BunRequest } from '../../bun.request.js'
import { BunResponse } from '../../bun.response.js'

@Controller()
class DummyController {
  @Get()
  getRoot() {
    throw new HttpException('Root endpoint error', 500)
  }
}

@Catch(HttpException)
class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<BunResponse>()
    const request = ctx.getRequest<BunRequest>()
    const status = exception.getStatus()
    const exceptionResponse = exception.getResponse()

    response.setStatus(status)
    response.end(
      typeof exceptionResponse === 'string'
        ? { message: exceptionResponse, date: new Date().toISOString(), path: request.pathname }
        : { ...exceptionResponse, date: new Date().toISOString(), path: request.pathname },
    )
  }
}

describe('BunAdapter ExceptionFilter', () => {
  const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
  let app: INestApplication<Server<unknown>>

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DummyController],
    }).compile()
    app = moduleRef.createNestApplication(new BunAdapter())
    app.useGlobalFilters(new HttpExceptionFilter())
    await app.listen(socket)
  })

  it('should handle HttpException with custom filter', async () => {
    const response = await fetch(`http://localhost/`, { unix: socket })
    const responseBody = (await response.json()) as { message: string, date: string, path: string }
    expect(response.status).toBe(500)
    expect(responseBody).toHaveProperty('message', 'Root endpoint error')
    expect(responseBody).toHaveProperty('path', '/')
    expect(new Date(responseBody.date).toString()).not.toBe('Invalid Date')
  })

  afterAll(async () => {
    await app.close()
    await Bun.file(socket).delete()
  })
})
