import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'

import { AppModule } from 'benchmarks/app/app.module.js'

async function main() {
  const app = await NestFactory.create(AppModule)
  await app.listen(3000)
  Logger.log(`Server started on http://localhost:3000`, 'NestApplication')
}

await main()
