import { CanActivate, Controller, ExecutionContext, Get, INestApplication, Injectable, UseGuards } from '@nestjs/common'
import { Server, randomUUIDv7 } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Observable } from 'rxjs'
import { Test } from '@nestjs/testing'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { BunAdapter } from '../../bun.adapter.js'
import { BunRequest } from '../../bun.request.js'

@Injectable()
class DummyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest<BunRequest>()
    // Simple guard logic: allow access only if a specific header is present
    return request.headers.get('x-allow-access') === 'true'
  }
}

@Controller()
class DummyController {
  @Get('/guarded')
  @UseGuards(DummyGuard)
  getGuarded() {
    return { message: 'Access granted' }
  }
}

describe('BunAdapter Guard', () => {
  const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
  let app: INestApplication<Server<unknown>>

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DummyController],
      providers: [DummyGuard],
    }).compile()
    app = moduleRef.createNestApplication(new BunAdapter())
    await app.listen(socket)
  })

  it('should allow access when guard condition is met', async () => {
    const response = await fetch(`http://localhost/guarded`, {
      unix: socket,
      headers: { 'x-allow-access': 'true' },
    })
    const responseBody = await response.json() as { message: string }
    expect(response.status).toBe(200)
    expect(responseBody).toEqual({ message: 'Access granted' })
  })

  it('should deny access when guard condition is not met', async () => {
    const response = await fetch(`http://localhost/guarded`, { unix: socket })
    expect(response.status).toBe(403)
  })

  afterAll(async () => {
    await app.close()
    await Bun.file(socket).delete()
  })
})
