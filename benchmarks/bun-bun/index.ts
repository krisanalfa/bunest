import { BunAdapter } from '@packages/bunest-adapter/lib/index.js'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { Server } from 'bun'

import { AppModule } from 'benchmarks/app/app.module.js'

async function main() {
  const app = await NestFactory.create(AppModule, new BunAdapter())
  await app.listen(3000, '127.0.0.1')
  const server = app.getHttpAdapter().getHttpServer() as Server<unknown>
  Logger.log(`Server started on ${server.url.toString()}`, 'NestApplication')
}

await main()
