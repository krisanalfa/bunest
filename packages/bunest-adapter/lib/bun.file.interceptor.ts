import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { basename, join } from 'node:path'
import { HttpAdapterHost } from '@nestjs/core'
import { Observable } from 'rxjs'
import { randomUUIDv7 } from 'bun'
import { tmpdir } from 'node:os'

import { BunAdapter } from './bun.adapter.js'
import { BunRequest } from './bun.request.js'

@Injectable()
export class BunFileInterceptor implements NestInterceptor {
  private readonly uploadDir = Bun.env.BUN_UPLOAD_DIR
  constructor(private readonly adapter: HttpAdapterHost) {
    const httpAdapter = this.adapter.httpAdapter as unknown as BunAdapter
    this.uploadDir ??= join(tmpdir(), 'uploads', httpAdapter.getHttpServer().id, randomUUIDv7())
  }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<BunRequest>()
    if (!request.files?.length) {
      return next.handle()
    }

    const files = await Promise.all(
      request.files.map(async (file) => {
        const destPath = join(this.uploadDir as unknown as string, basename(file.name))
        await Bun.write(destPath, file)
        return Bun.file(destPath) as unknown as File
      }),
    )
    request.setFile(files[0])
    request.setFiles(files)

    return next.handle()
  }
}
