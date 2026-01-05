import { BunAdapter, NestBunApplication } from '@packages/bunest-adapter/lib/index.js'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'

import { AppModule } from 'benchmarks/app/app.module.js'

async function main() {
  const app = await NestFactory.create<NestBunApplication>(AppModule, new BunAdapter())
  await app.listen(3000, '127.0.0.1')
  const server = app.getHttpServer().getBunServer()
  Logger.log(`Server started on ${server?.url.toString() ?? 'http://localhost:3000'}`, 'NestApplication')
}

await main()
