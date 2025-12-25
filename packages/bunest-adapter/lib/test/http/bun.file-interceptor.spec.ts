import { BunFile, Server, randomUUIDv7 } from 'bun'
import { Controller, INestApplication, Post, Res, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { basename, join } from 'node:path'
import { Test } from '@nestjs/testing'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { BunAdapter } from '../../bun.adapter.js'
import { BunFileInterceptor } from '../../bun.file.interceptor.js'
import { BunResponse } from '../../bun.response.js'

Bun.env.BUN_UPLOAD_DIR = join(tmpdir(), randomUUIDv7())

@Controller()
class DummyController {
  @Post()
  @UseInterceptors(BunFileInterceptor)
  postRoot(@Res({ passthrough: true }) res: BunResponse, @UploadedFile() file?: BunFile) {
    res.setHeader('x-file-path', file?.name ?? 'none')
    res.setHeader('x-file-name', basename(file?.name ?? 'none'))
    res.end(file)
  }

  @Post('files')
  @UseInterceptors(BunFileInterceptor)
  postFiles(@UploadedFiles() files: BunFile[], @Res({ passthrough: true }) res: BunResponse) {
    for (const file of files) {
      res.appendHeader('x-file-names', basename(file.name ?? 'none'))
    }
    // Pick the last file for testing purposes
    res.end(files[files.length - 1])
  }
}

describe('BunFileInterceptor', () => {
  const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
  let app: INestApplication<Server<unknown>>

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DummyController],
    }).compile()
    app = moduleRef.createNestApplication(new BunAdapter())
    await app.listen(socket)
  })

  describe('Uploading files', () => {
    it.serial('should intercept and process uploaded a single file', async () => {
      // Create a temporary file to upload
      const tempFilePath = join(tmpdir(), 'test-upload.txt')
      const fileContent = 'Hello, Bunest!'
      await Bun.write(tempFilePath, fileContent)
      const formData = new FormData()
      formData.append('file', Bun.file(tempFilePath))

      const response = await fetch('http://localhost:3000', {
        method: 'POST',
        unix: socket,
        body: formData,
      })

      expect(response.status).toBe(201)
      const text = await response.text()
      expect(text).toBe(fileContent)
      // Should retain original file name
      expect(response.headers.get('x-file-name')).toBe('test-upload.txt')
      // Should provide the full file path
      expect(response.headers.get('x-file-path')).toBe(join(process.env.BUN_UPLOAD_DIR as unknown as string, 'test-upload.txt'))

      // Clean up the temporary file
      await Bun.file(tempFilePath).delete()
    })

    it.serial('should handle requests with no files gracefully', async () => {
      const response = await fetch('http://localhost:3000', {
        method: 'POST',
        unix: socket,
      })

      expect(response.status).toBe(201)
      const text = await response.text()
      expect(text).toBe('')
    })

    it.serial('should handle requests with multiple files', async () => {
      // Create temporary files to upload
      const tempFilePath1 = join(tmpdir(), 'test-upload1.txt')
      const tempFilePath2 = join(tmpdir(), 'test-upload2.txt')
      await Bun.write(tempFilePath1, 'File 1 Content')
      await Bun.write(tempFilePath2, 'File 2 Content')

      const formData = new FormData()
      formData.append('file', Bun.file(tempFilePath1))
      formData.append('file', Bun.file(tempFilePath2))

      const response = await fetch('http://localhost:3000/files', {
        method: 'POST',
        unix: socket,
        body: formData,
      })

      expect(response.status).toBe(201)
      const text = await response.text()
      expect(text).toBe('File 2 Content') // Only the last file is returned
      // Should retain original file names
      expect(response.headers.get('x-file-names')).toBe('test-upload1.txt, test-upload2.txt')

      // Clean up the temporary files
      await Bun.file(tempFilePath1).delete()
      await Bun.file(tempFilePath2).delete()
    })
  })

  afterAll(async () => {
    await app.close()
    await Bun.file(socket).delete()
    await rm(process.env.BUN_UPLOAD_DIR as unknown as string, { recursive: true, force: true })
  })
})
