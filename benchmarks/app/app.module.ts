import { Module } from '@nestjs/common'

import { AppController } from './app.controller.js'

@Module({
  controllers: [AppController],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AppModule {}
