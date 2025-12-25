import { Controller, Get } from '@nestjs/common'

@Controller()
export class AppController {
  @Get()
  public index() {
    return {
      msg: 'Hello, world!',
    }
  }
}
