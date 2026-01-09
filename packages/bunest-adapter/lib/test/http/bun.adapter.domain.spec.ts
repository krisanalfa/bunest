import { Controller, Get, HostParam, INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Server } from 'bun'
import { Test } from '@nestjs/testing'

import { BunAdapter } from '../../bun.adapter.js'

@Controller({ host: 'subdomainA.localhost' })
class DummyControllerA {
  @Get('a')
  getRoot() {
    return { message: 'Hello, from A!' }
  }
}

@Controller({ host: 'subdomainB.localhost' })
class DummyControllerB {
  @Get('b')
  getRoot() {
    return { message: 'Hello, from B!' }
  }
}

@Controller({ host: ':account.example.localhost' })
class DummyControllerC {
  @Get('c')
  getRoot(@HostParam('account') account: string) {
    return { message: `Hello, ${account}!` }
  }
}

describe('Bun SubDomain', () => {
  let app: INestApplication<Server<unknown>>
  let url: string

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DummyControllerA, DummyControllerB, DummyControllerC],
    }).compile()
    app = moduleRef.createNestApplication(new BunAdapter())
    await app.listen(0)
    const server = app.getHttpAdapter().getHttpServer() as Server<unknown>
    url = server.url.toString()
  })

  it('should handle HTTP requests to the subdomainA', async () => {
    const response = await fetch(`${url}/a`, {
      headers: { host: 'subdomainA.localhost' },
    })
    expect(response.status).toBe(200)
    const data = await response.json() as { message: string }
    expect(data).toEqual({ message: 'Hello, from A!' })
  })

  it('should handle HTTP requests to the subdomainB', async () => {
    const response = await fetch(`${url}/b`, {
      headers: { host: 'subdomainB.localhost' },
    })
    expect(response.status).toBe(200)
    const data = await response.json() as { message: string }
    expect(data).toEqual({ message: 'Hello, from B!' })
  })

  it('should handle HTTP requests to the dynamic subdomain', async () => {
    const response = await fetch(`${url}/c`, {
      headers: { host: 'myaccount.example.localhost' },
    })
    expect(response.status).toBe(200)
    const data = await response.json() as { message: string }
    expect(data).toEqual({ message: 'Hello, myaccount!' })
  })

  it('should reject HTTP requests to an unknown subdomain', async () => {
    const response = await fetch(`${url}/a`, {
      headers: { host: 'unknown.localhost' },
    })
    expect(response.status).toBe(404)
    const data = await response.json() as { statusCode: number, message: string, error: string }
    expect(data).toEqual({
      statusCode: 404,
      message: 'Cannot GET /a',
      error: 'Not Found',
    })
  })

  it('should handle X-Forwarded-Host header for subdomain routing', async () => {
    const response = await fetch(`${url}/a`, {
      headers: { 'X-Forwarded-Host': 'subdomainA.localhost' },
    })
    expect(response.status).toBe(200)
    const data = await response.json() as { message: string }
    expect(data).toEqual({ message: 'Hello, from A!' })
  })

  afterAll(async () => {
    await app.close()
  })
})
