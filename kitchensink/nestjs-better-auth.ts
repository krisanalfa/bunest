import { AllowAnonymous, AuthModule } from '@thallesp/nestjs-better-auth'
import { BetterAuthOptions, InferSession, InferUser, betterAuth } from 'better-auth'
import { Controller, Get, Logger, Module, Req, Session } from '@nestjs/common'
import Database from 'bun:sqlite'
import { NestFactory } from '@nestjs/core'
import { Server } from 'bun'
import { getMigrations } from 'better-auth/db'

import { BunAdapter } from '@packages/bunest-adapter/lib/bun.adapter.js'
import { BunRequest } from '@packages/bunest-adapter/lib/bun.request.js'

type User = InferUser<BetterAuthOptions>
type Session = InferSession<BetterAuthOptions> & { user?: User }
declare module '@packages/bunest-adapter/lib/bun.request.js' {
  interface BunRequest {
    session?: Session
    user?: User
  }
}

@Controller('api/auth')
class AuthController {
  @Get('public')
  @AllowAnonymous()
  getPublic() {
    return { message: 'public' }
  }

  @Get('with-session')
  getWithSession(@Session() session: Session) {
    return { hasSession: !!session, session }
  }

  @Get('request-access')
  getRequestAccess(@Req() req: BunRequest) {
    return {
      hasSession: !!req.session,
      hasUser: !!req.user,
    }
  }
}

const database = new Database(':memory:')
const auth = betterAuth({
  trustedOrigins: ['http://localhost:3000'],
  database,
  emailAndPassword: {
    enabled: true,
  },
})

@Module({
  imports: [AuthModule.forRoot({
    auth,
    disableBodyParser: true,
    disableTrustedOriginsCors: true,
  })],
  controllers: [AuthController],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class AppModule {}

const main = async () => {
  // Run migrations
  const { runMigrations } = await getMigrations({
    database,
    emailAndPassword: {
      enabled: true,
    },
  })
  await runMigrations()

  const app = await NestFactory.create(AppModule, new BunAdapter(), { cors: true })
  await app.listen(3000, '127.0.0.1')
  const server = app.getHttpAdapter().getHttpServer() as Server<unknown>
  Logger.log(`Server started on ${server.url.toString()}`, 'NestApplication')
}

await main()
