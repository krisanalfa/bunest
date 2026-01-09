import { Body, Controller, INestApplication, Post, ValidationPipe } from '@nestjs/common'
import { IsNumber, IsString } from 'class-validator'
import { Server, randomUUIDv7 } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Test } from '@nestjs/testing'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { BunAdapter } from '../../bun.adapter.js'

class DummyDto {
  @IsString()
  name!: string

  @IsNumber()
  age!: number
}

@Controller()
class DummyController {
  @Post('/validate')
  postValidate(@Body() dto: DummyDto) {
    return { message: 'DTO is valid', data: dto }
  }
}

describe('BunAdapter Validation Pipe', () => {
  const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
  let app: INestApplication<Server<unknown>>

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DummyController],
    }).compile()
    app = moduleRef.createNestApplication(new BunAdapter())
    app.useGlobalPipes(new ValidationPipe())
    await app.listen(socket)
  })

  it('should validate incoming request DTOs (valid data)', async () => {
    const validResponse = await fetch(`http://localhost/validate`, {
      unix: socket,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'John Doe', age: 30 }),
    })
    const validResponseBody = await validResponse.json() as { message: string, data: DummyDto }
    expect(validResponse.status).toBe(201)
    expect(validResponseBody).toEqual({
      message: 'DTO is valid',
      data: { name: 'John Doe', age: 30 },
    })
  })

  it('should reject invalid DTOs with 400 Bad Request', async () => {
    const invalidResponse = await fetch(`http://localhost/validate`, {
      unix: socket,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'John Doe', age: 'thirty' }),
    })
    const invalidResponseBody = await invalidResponse.json() as { statusCode: number, message: string[] }
    expect(invalidResponse.status).toBe(400)
    expect(invalidResponseBody).toHaveProperty('statusCode', 400)
    expect(invalidResponseBody).toHaveProperty('message')
    expect(Array.isArray(invalidResponseBody.message)).toBe(true)
    expect(invalidResponseBody.message).toHaveLength(1)
    expect(invalidResponseBody.message[0]).toContain('age must be a number')
  })

  afterAll(async () => {
    await app.close()
    await Bun.file(socket).delete()
  })
})
