import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Head,
  Header,
  Headers,
  INestApplication,
  Param,
  ParseDatePipe,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Redirect,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UploadedFiles,
} from '@nestjs/common'
import { Server, randomUUIDv7 } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Test } from '@nestjs/testing'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { BunAdapter } from '../../bun.adapter.js'
import { BunRequest } from '../../bun.request.js'
import { BunResponse } from '../../bun.response.js'

// Testing controllers will be added here later
@Controller()
class DummyController {
  @Get('/')
  getRoot() {
    return { message: 'Hello, World!' }
  }

  @Get('/array')
  getArray() {
    return ['item1', 'item2', 'item3']
  }

  @Post('/')
  postRoot(@Body() body: unknown) {
    return { message: 'Posted!', data: body }
  }

  @Put('/')
  putRoot(@Body() body: unknown) {
    return { message: 'Put!', data: body }
  }

  @Patch('/')
  patchRoot(@Body() body: unknown) {
    return { message: 'Patched!', data: body }
  }

  @Delete('/')
  deleteRoot() {
    return { message: 'Deleted!' }
  }

  @Head('/')
  headRoot() {
    return {}
  }

  @Get('/query')
  getQuery(@Query('param') param: string) {
    return { param }
  }

  @Get('/queries')
  getQueries(@Query() query: Record<string, string>) {
    return query
  }

  @Get('/headers')
  getHeaders(@Headers() headers: Record<string, string>) {
    return headers
  }

  @Get('/header')
  getHeader(@Headers('x-custom-header') customHeader: string) {
    return { 'x-custom-header': customHeader }
  }

  @Post('/file')
  postFile(@UploadedFile('file') file: File) {
    return { filename: file.name, size: file.size }
  }

  @Post('/files')
  postFiles(@UploadedFiles() files: File[]) {
    return files.map(file => ({ filename: file.name, size: file.size }))
  }

  @Get('/stream')
  @Header('X-Custom-Header', 'CustomValue')
  getStream() {
    const buffer = new TextEncoder().encode(
      'This is a streamable file content.',
    )
    return new StreamableFile(buffer, {
      type: 'text/plain',
      disposition: 'attachment; filename="stream.txt"',
    })
  }

  @Get('/redirect-from')
  @Redirect('/redirect-to', 302)
  redirectFrom() {
    return { message: 'Redirected!' }
  }

  @Get('/redirect-to')
  redirectTo() {
    return { message: 'You have been redirected!' }
  }

  @Get('/pipe')
  getPipe(@Query('date', new ParseDatePipe()) date: Date) {
    return { date: date.toISOString() }
  }

  @Get('/multi-headers')
  @Header('X-First-Header', 'FirstValue')
  @Header('X-Second-Header', 'SecondValue')
  @Header('Cache-Control', 'no-cache')
  getMultiHeaders() {
    return { message: 'Multiple headers set!' }
  }

  @Get('/param/:id')
  getParam(@Param('id') id: string) {
    return { id }
  }

  @Get('/params/:one/:two/:three')
  getParams(@Param() params: Record<string, string>) {
    return params
  }

  @Get('/number-param/:num')
  getNumberParam(@Param('num', new ParseIntPipe()) num: number) {
    return { num }
  }

  @Get('/bad-request')
  getBadRequest() {
    throw new BadRequestException({
      message: 'This is a bad request example.',
    }, {
      cause: new Error('Underlying cause of the bad request'),
      description: 'BadRequestException thrown in DummyController',
    })
  }

  @Get('/cookies')
  getCookies(
    @Req() request: BunRequest,
    @Res({ passthrough: true }) response: BunResponse,
  ) {
    const cookies = request.cookies
    response.cookie('bar', 'baz')

    return {
      message: 'Cookies endpoint', mine: {
        foo: cookies.get('foo'),
      },
    }
  }
}

describe('BunAdapter Controller', () => {
  const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
  let app: INestApplication<Server<unknown>>

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DummyController],
    }).compile()
    app = moduleRef.createNestApplication(new BunAdapter(), {
      cors: true, // Enable CORS for testing
      bodyParser: true, // Enable body parsing for testing
    })
    await app.listen(socket)
  })

  describe('Cookies', () => {
    it('should receive and set cookies in GET /cookies', async () => {
      const response = await fetch(
        `http://localhost/cookies`,
        {
          unix: socket,
          method: 'GET',
          headers: { Cookie: 'foo=bar' },
        },
      )
      const data = (await response.json()) as {
        message: string
        mine: { foo: string | undefined }
      }
      expect(response.status).toBe(200)
      expect(data.mine.foo).toBe('bar')
      expect(response.headers.get('set-cookie')).toContain('bar=baz; Path=/')
    })
  })

  describe('CORS', () => {
    it('should include CORS headers in responses', async () => {
      const response = await fetch(`http://localhost`, { unix: socket })
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
    })

    it('should handle preflight OPTIONS request', async () => {
      const response = await fetch(
        `http://localhost/`,
        {
          unix: socket,
          method: 'OPTIONS',
          headers: {
            'Origin': 'http://example.com',
            'Access-Control-Request-Method': 'POST',
          },
        },
      )
      expect(response.status).toBe(204)
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
      expect(response.headers.get('access-control-allow-methods')).toBe(
        'GET,HEAD,PUT,PATCH,POST,DELETE',
      )
      expect(response.headers.get('vary')).toBe('Access-Control-Request-Headers')
      expect(response.headers.get('content-length')).toBe('0')
      const body = await response.text()
      expect(body).toBe('')
    })
  })

  describe('Basic request', () => {
    it('should return 200 for GET /', async () => {
      const response = await fetch(`http://localhost/`, { unix: socket })
      const data = (await response.json()) as { message: string }
      expect(response.status).toBe(200)
      expect(data.message).toBe('Hello, World!')
    })

    it('should return array for GET /array', async () => {
      const response = await fetch(`http://localhost/array`, { unix: socket })
      const data = (await response.json()) as string[]
      expect(response.status).toBe(200)
      expect(data).toEqual(['item1', 'item2', 'item3'])
    })

    it('should return query parameters for GET /query', async () => {
      const response = await fetch(
        `http://localhost/query?param=testValue`,
        { unix: socket },
      )
      const data = (await response.json()) as { param: string }
      expect(response.status).toBe(200)
      expect(data.param).toBe('testValue')
    })

    it('should return query parameters with arrays for GET /query', async () => {
      const response = await fetch(
        `http://localhost/query?param[]=value1&param[]=value2&param[]=value3`,
        { unix: socket },
      )
      const data = (await response.json()) as { param: string[] }
      expect(response.status).toBe(200)
      expect(data.param).toEqual(['value1', 'value2', 'value3'])
    })

    it('should return query parameters with objects for GET /query', async () => {
      const response = await fetch(
        `http://localhost/query?param[key1]=value1&param[key2]=value2`,
        { unix: socket },
      )
      const data = (await response.json()) as { param: Record<string, string> }
      expect(response.status).toBe(200)
      expect(data.param).toEqual({ key1: 'value1', key2: 'value2' })
    })

    it('should return all query parameters for GET /queries', async () => {
      const q = new URLSearchParams()
      q.append('param1', 'value1')
      q.append('param2', 'value2')
      q.append('param3', 'this value has spaces')
      const response = await fetch(
        `http://localhost/queries?${q.toString()}`,
        { unix: socket },
      )
      const data = (await response.json()) as Record<string, string>
      expect(response.status).toBe(200)
      expect(data.param1).toBe('value1')
      expect(data.param2).toBe('value2')
      expect(data.param3).toBe('this value has spaces')
    })

    it('should return path parameter for GET /param/:id', async () => {
      const response = await fetch(
        `http://localhost/param/12345`,
        { unix: socket },
      )
      const data = (await response.json()) as { id: string }
      expect(response.status).toBe(200)
      expect(data.id).toBe('12345')
    })

    it('should return path parameters for GET /params/:one/:two/:three', async () => {
      const response = await fetch(
        `http://localhost/params/alpha/beta/gamma`,
        { unix: socket },
      )
      const data = (await response.json()) as Record<string, string>
      expect(response.status).toBe(200)
      expect(data.one).toBe('alpha')
      expect(data.two).toBe('beta')
      expect(data.three).toBe('gamma')
    })

    it('should return number path parameter for GET /number-param/:num', async () => {
      const response = await fetch(
        `http://localhost/number-param/42`,
        { unix: socket },
      )
      const data = (await response.json()) as { num: number }
      expect(response.status).toBe(200)
      expect(data.num).toBe(42)
    })
  })

  describe('Body parser', () => {
    describe('JSON body', () => {
      it.each([
        {
          method: 'POST',
          path: '/',
          body: { hello: 'world' },
          expectedStatus: 201,
        },
        { method: 'PUT', path: '/', body: { foo: 'bar' }, expectedStatus: 200 },
        {
          method: 'PATCH',
          path: '/',
          body: { baz: 'qux' },
          expectedStatus: 200,
        },
        { method: 'DELETE', path: '/', body: undefined, expectedStatus: 200 },
      ])(
        'should parse JSON body for $method request to $path',
        async ({ method, path, body, expectedStatus }) => {
          const response = await fetch(
            `http://localhost${path}`,
            {
              unix: socket,
              method,
              headers: { 'Content-Type': 'application/json' },
              body: body !== undefined ? JSON.stringify(body) : undefined,
            },
          )
          const data = (await response.json()) as {
            message: string
            data: typeof body
          }
          expect(response.status).toBe(expectedStatus)
          expect(data.data).toEqual(body)
        },
      )
    })

    describe('Form Data body', () => {
      it('should parse Form Data body for POST request', async () => {
        const formData = new FormData()
        formData.append('field1', 'value1')
        formData.append('field2', 'value2')

        const response = await fetch(
          `http://localhost/`,
          {
            unix: socket,
            method: 'POST',
            body: formData,
          },
        )
        const data = (await response.json()) as {
          message: string
          data: Record<string, string>
        }
        expect(response.status).toBe(201)
        expect(data.data).toEqual({ field1: 'value1', field2: 'value2' })
      })
    })

    describe('URL-encoded body', () => {
      it('should parse URL-encoded body for PATCH request', async () => {
        const urlEncodedBody = new URLSearchParams()
        urlEncodedBody.append('param1', 'value1')
        urlEncodedBody.append('param2', 'value2')

        const response = await fetch(
          `http://localhost/`,
          {
            unix: socket,
            method: 'PATCH',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: urlEncodedBody.toString(),
          },
        )
        const data = (await response.json()) as {
          message: string
          data: Record<string, string>
        }
        expect(response.status).toBe(200)
        expect(data.data).toEqual({ param1: 'value1', param2: 'value2' })
      })
    })

    describe('Text body', () => {
      it('should parse Text body for PUT request', async () => {
        const textBody = 'This is a plain text body.'

        const response = await fetch(
          `http://localhost/`,
          {
            unix: socket,
            method: 'PUT',
            headers: { 'Content-Type': 'text/plain' },
            body: textBody,
          },
        )
        const data = (await response.json()) as {
          message: string
          data: string
        }
        expect(response.status).toBe(200)
        expect(data.data).toBe(textBody)
      })
    })

    describe('File upload', () => {
      it('should parse uploaded file in POST request', async () => {
        const formData = new FormData()
        const fileContent = 'Hello, this is a test file.'
        const file = new Blob([fileContent], { type: 'text/plain' })
        formData.append('file', file, 'testfile.txt')

        const response = await fetch(
          `http://localhost/file`,
          {
            unix: socket,
            method: 'POST',
            body: formData,
          },
        )
        const data = (await response.json()) as {
          filename: string
          size: number
        }
        expect(response.status).toBe(201)
        expect(data.filename).toBe('testfile.txt')
        expect(data.size).toBe(fileContent.length)
      })

      it('should parse multiple uploaded files in POST request', async () => {
        const formData = new FormData()
        const file1Content = 'Content of file one.'
        const file2Content = 'Content of file two.'
        const file1 = new Blob([file1Content], { type: 'text/plain' })
        const file2 = new Blob([file2Content], { type: 'text/plain' })
        formData.append('files', file1, 'file1.txt')
        formData.append('files', file2, 'file2.txt')

        const response = await fetch(
          `http://localhost/files`,
          {
            unix: socket,
            method: 'POST',
            body: formData,
          },
        )
        const data = (await response.json()) as {
          filename: string
          size: number
        }[]
        expect(response.status).toBe(201)
        expect(data).toHaveLength(2)
        expect(data[0].filename).toBe('file1.txt')
        expect(data[0].size).toBe(file1Content.length)
        expect(data[1].filename).toBe('file2.txt')
        expect(data[1].size).toBe(file2Content.length)
      })
    })
  })

  describe('HEAD request', () => {
    it('should handle HEAD request and return headers', async () => {
      const response = await fetch(
        `http://localhost/`,
        {
          unix: socket,
          method: 'HEAD',
          headers: { 'X-Custom-Header': 'CustomValue' },
        },
      )
      expect(response.status).toBe(200)
      // HEAD responses should not have a body
      const text = await response.text()
      expect(text).toBe('')
    })
  })

  describe('Custom Headers', () => {
    it('should receive custom headers in GET request', async () => {
      const response = await fetch(
        `http://localhost/header`,
        {
          unix: socket,
          method: 'GET',
          headers: { 'X-Custom-Header': 'MyHeaderValue' },
        },
      )
      const data = (await response.json()) as { 'x-custom-header': string }
      expect(response.status).toBe(200)
      expect(data['x-custom-header']).toBe('MyHeaderValue')
    })

    it('should receive all headers in GET request', async () => {
      const response = await fetch(
        `http://localhost/headers`,
        {
          unix: socket,
          method: 'GET',
          headers: {
            'X-Custom-Header': 'HeaderValue',
            'Another-Header': 'AnotherValue',
          },
        },
      )
      const data = (await response.json()) as Record<string, string>
      expect(response.status).toBe(200)
      expect(data['x-custom-header']).toBe('HeaderValue')
      expect(data['another-header']).toBe('AnotherValue')
    })
  })

  describe('Response Headers (@Header decorator)', () => {
    it('should set multiple response headers using @Header decorator', async () => {
      const response = await fetch(
        `http://localhost/multi-headers`,
        { unix: socket },
      )
      const data = (await response.json()) as { message: string }
      expect(response.status).toBe(200)
      expect(data.message).toBe('Multiple headers set!')
      expect(response.headers.get('x-first-header')).toBe('FirstValue')
      expect(response.headers.get('x-second-header')).toBe('SecondValue')
      expect(response.headers.get('cache-control')).toBe('no-cache')
    })
  })

  describe('Streamable File', () => {
    it('should return a streamable file in GET /stream', async () => {
      const response = await fetch(
        `http://localhost/stream`,
        { unix: socket },
      )
      const text = await response.text()
      expect(response.status).toBe(200)
      expect(text).toBe('This is a streamable file content.')
      expect(response.headers.get('content-disposition')).toBe(
        'attachment; filename="stream.txt"',
      )
      expect(response.headers.get('content-type')).toBe('text/plain')
      expect(response.headers.get('x-custom-header')).toBe('CustomValue')
      expect(response.headers.get('content-length')).toBe(
        '34',
      )
    })
  })

  describe('Redirection', () => {
    it('should redirect from /redirect-from to /redirect-to', async () => {
      const response = await fetch(
        `http://localhost/redirect-from`,
        {
          unix: socket,
          redirect: 'manual',
        },
      )
      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe('/redirect-to')
    })

    it('should follow redirection to /redirect-to', async () => {
      const response = await fetch(
        `http://localhost/redirect-from`,
        { unix: socket },
      )
      expect(response.url).toBe(
        `http://localhost/redirect-to`,
      )
      const data = (await response.json()) as { message: string }
      expect(response.status).toBe(200)
      expect(data.message).toBe('You have been redirected!')
    })
  })

  describe('Pipes', () => {
    it('should parse date query parameter using ParseDatePipe', async () => {
      const testDate = '2024-06-15T12:34:56.789Z'
      const response = await fetch(
        `http://localhost/pipe?date=${encodeURIComponent(testDate)}`,
        { unix: socket },
      )
      const data = (await response.json()) as { date: string }
      expect(response.status).toBe(200)
      expect(data.date).toBe(testDate)
    })

    it('should return 400 for invalid date format', async () => {
      const invalidDate = 'invalid-date-string'
      const response = await fetch(
        `http://localhost/pipe?date=${encodeURIComponent(invalidDate)}`,
        { unix: socket },
      )
      expect(response.status).toBe(400)
      const data = (await response.json()) as {
        statusCode: number
        message: string
        error: string
      }
      expect(data.statusCode).toBe(400)
      expect(data.error).toBe('Bad Request')
      expect(data.message).toContain('invalid date format')
    })
  })

  describe('Default Nest Exception Filter', () => {
    it('should return 404 for non-existing route', async () => {
      const response = await fetch(
        `http://localhost/non-existing-route`,
        { unix: socket },
      )
      expect(response.status).toBe(404)
      const data = (await response.json()) as {
        statusCode: number
        message: string
        error: string
      }
      expect(data.statusCode).toBe(404)
      expect(data.error).toBe('Not Found')
      expect(data.message).toBe('Cannot GET /non-existing-route')
    })

    it('should return 400 for BadRequestException', async () => {
      const response = await fetch(
        `http://localhost/bad-request`,
        { unix: socket },
      )
      expect(response.status).toBe(400)
      const data = (await response.json()) as {
        message: string
      }
      expect(data.message).toBe('This is a bad request example.')
    })
  })

  afterAll(async () => {
    await app.close()
    await Bun.file(socket).delete()
  })
})
