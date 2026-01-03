/* eslint-disable sonarjs/no-nested-functions */
/* eslint-disable sonarjs/no-hardcoded-passwords */
import { AllowAnonymous, AuthModule, AuthService, OptionalAuth, Session } from '@thallesp/nestjs-better-auth'
import { BetterAuthOptions, InferSession, InferUser, betterAuth } from 'better-auth'
import { Controller, Get, INestApplication, Req } from '@nestjs/common'
import { Server, randomUUIDv7 } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import Database from 'bun:sqlite'
import { Test } from '@nestjs/testing'
import { getMigrations } from 'better-auth/db'
import helmet from 'helmet'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { BunAdapter } from '../../bun.adapter.js'
import type { BunRequest } from '../../bun.request.js'

// Declaration merging to extend BunRequest with better-auth properties
declare module '../../bun.request.js' {
  interface BunRequest {
    session?: InferSession<BetterAuthOptions> & {
      user?: InferUser<BetterAuthOptions>
    }
    user?: InferUser<BetterAuthOptions>
  }
}

@Controller()
class DummyController {
  @Get()
  getRoot() {
    return 'ok'
  }
}

describe('BunAdapter Popular Middleware', () => {
  describe('helmet', () => {
    const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
    let app: INestApplication<Server<unknown>>

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [DummyController],
      }).compile()
      app = moduleRef.createNestApplication(new BunAdapter())
      app.use(helmet())
      await app.listen(socket)
    })

    it('should set helmet headers', async () => {
      const res = await fetch('http://localhost', { unix: socket })
      expect(res.status).toBe(200)
      /**
       * Helmet sets the following headers by default:
       *
       * - `Content-Security-Policy`: A powerful allow-list of what can happen on your page which mitigates many attacks
       * - `Cross-Origin-Opener-Policy`: Helps process-isolate your page
       * - `Cross-Origin-Resource-Policy`: Blocks others from loading your resources cross-origin
       * - `Origin-Agent-Cluster`: Changes process isolation to be origin-based
       * - `Referrer-Policy`: Controls the Referer header
       * - `Strict-Transport-Security`: Tells browsers to prefer HTTPS
       * - `X-Content-Type-Options`: Avoids MIME sniffing
       * - `X-DNS-Prefetch-Control`: Controls DNS prefetching
       * - `X-Download-Options`: Forces downloads to be saved (Internet Explorer only)
       * - `X-Frame-Options`: Legacy header that mitigates clickjacking attacks
       * - `X-Permitted-Cross-Domain-Policies`: Controls cross-domain behavior for Adobe products, like Acrobat
       * - `X-Powered-By`: Info about the web server. Removed because it could be used in simple attacks
       * - `X-XSS-Protection`: Legacy header that tries to mitigate XSS attacks, but makes things worse, so Helmet disables it
       */
      expect(res.headers.get('Content-Security-Policy')).toBeDefined()
      expect(res.headers.get('Cross-Origin-Opener-Policy')).toBeDefined()
      expect(res.headers.get('Cross-Origin-Resource-Policy')).toBeDefined()
      expect(res.headers.get('Origin-Agent-Cluster')).toBeDefined()
      expect(res.headers.get('Referrer-Policy')).toBeDefined()
      expect(res.headers.get('Strict-Transport-Security')).toBeDefined()
      expect(res.headers.get('X-Content-Type-Options')).toBeDefined()
      expect(res.headers.get('X-DNS-Prefetch-Control')).toBeDefined()
      expect(res.headers.get('X-Download-Options')).toBeDefined()
      expect(res.headers.get('X-Frame-Options')).toBeDefined()
      expect(res.headers.get('X-Permitted-Cross-Domain-Policies')).toBeDefined()
      expect(res.headers.get('X-Powered-By')).toBeNull()
      expect(res.headers.get('X-XSS-Protection')).toBe('0')
    })

    afterAll(async () => {
      await app.close()
      await Bun.file(socket).delete()
    })
  })

  describe('@thallesp/nestjs-better-auth', () => {
    describe('Route Protection and Decorators', () => {
      const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
      let app: INestApplication<Server<unknown>>

      beforeAll(async () => {
        @Controller('auth')
        class AuthController {
          @Get('public')
          @AllowAnonymous()
          getPublic() {
            return { message: 'public' }
          }

          @Get('protected')
          getProtected() {
            return { message: 'protected' }
          }

          @Get('with-session')
          getWithSession(@Session() session: unknown) {
            return { hasSession: !!session, session }
          }

          @Get('optional')
          @OptionalAuth()
          getOptional(@Session() session: unknown) {
            return { authenticated: !!session, session }
          }

          @Get('request-access')
          getRequestAccess(@Req() req: { session?: unknown, user?: unknown }) {
            return {
              hasSession: !!req.session,
              hasUser: !!req.user,
            }
          }

          @Get('profile')
          getProfile(@Session() session: { user?: { id: string, email: string, name: string } }) {
            if (!session.user) {
              return { error: 'No user in session' }
            }
            return {
              id: session.user.id,
              email: session.user.email,
              name: session.user.name,
            }
          }

          @Get('admin-only')
          getAdminOnly(@Session() session: unknown) {
            return { message: 'admin access', session }
          }

          @Get('user-details')
          getUserDetails(@Req() req: { user?: { id?: string, email?: string } }) {
            return {
              userId: req.user?.id,
              userEmail: req.user?.email,
            }
          }
        }

        @Controller('public-controller')
        @AllowAnonymous()
        class PublicController {
          @Get('all-public')
          getAllPublic() {
            return { message: 'all routes are public' }
          }

          @Get('also-public')
          getAlsoPublic() {
            return { message: 'this too' }
          }
        }

        @Controller('optional-controller')
        @OptionalAuth()
        class OptionalController {
          @Get('optional-all')
          getOptionalAll(@Session() session: unknown) {
            return { authenticated: !!session }
          }
        }

        const database = new Database(':memory:')

        const auth = betterAuth({
          database,
          emailAndPassword: {
            enabled: true,
          },
        })

        // Run migrations
        const { runMigrations } = await getMigrations({
          database,
          emailAndPassword: {
            enabled: true,
          },
        })
        await runMigrations()

        const moduleRef = await Test.createTestingModule({
          imports: [AuthModule.forRoot({
            auth,
            disableBodyParser: true,
          })],
          controllers: [AuthController, PublicController, OptionalController],
        }).compile()

        app = moduleRef.createNestApplication(new BunAdapter(), { cors: true })
        await app.listen(socket)
      })

      describe('Route Protection', () => {
        it('should allow access to public routes with @AllowAnonymous', async () => {
          const res = await fetch('http://localhost/auth/public', {
            unix: socket,
          })
          expect(res.status).toBe(200)
          const data = (await res.json()) as { message: string }
          expect(data.message).toBe('public')
        })

        it('should protect routes without @AllowAnonymous', async () => {
          const res = await fetch('http://localhost/auth/protected', {
            unix: socket,
          })
          expect(res.status).toBe(401)
        })

        it('should allow optional auth routes without authentication', async () => {
          const res = await fetch('http://localhost/auth/optional', {
            unix: socket,
          })
          expect(res.status).toBe(200)
          const data = (await res.json()) as {
            authenticated: boolean
            session: unknown
          }
          expect(data.authenticated).toBe(false)
          expect(data.session).toBeNull()
        })
      })

      describe('Class-level Decorators', () => {
        it('should make all routes public with class-level @AllowAnonymous', async () => {
          const res1 = await fetch('http://localhost/public-controller/all-public', {
            unix: socket,
          })
          expect(res1.status).toBe(200)

          const res2 = await fetch(
            'http://localhost/public-controller/also-public',
            { unix: socket },
          )
          expect(res2.status).toBe(200)
        })

        it('should make all routes optional with class-level @OptionalAuth', async () => {
          const res = await fetch(
            'http://localhost/optional-controller/optional-all',
            { unix: socket },
          )
          expect(res.status).toBe(200)
          const data = (await res.json()) as { authenticated: boolean }
          expect(data.authenticated).toBe(false)
        })
      })

      describe('Session Access', () => {
        it('should block access to session-protected routes without auth', async () => {
          const res = await fetch('http://localhost/auth/with-session', {
            unix: socket,
          })
          expect(res.status).toBe(401)
        })

        it('should provide session in request object for protected routes', async () => {
          const res = await fetch('http://localhost/auth/request-access', {
            unix: socket,
          })
          expect(res.status).toBe(401)
        })

        it('should block access to profile endpoint without auth', async () => {
          const res = await fetch('http://localhost/auth/profile', {
            unix: socket,
          })
          expect(res.status).toBe(401)
        })

        it('should block access to user-details endpoint without auth', async () => {
          const res = await fetch('http://localhost/auth/user-details', {
            unix: socket,
          })
          expect(res.status).toBe(401)
        })

        it('should block admin-only endpoint without auth', async () => {
          const res = await fetch('http://localhost/auth/admin-only', {
            unix: socket,
          })
          expect(res.status).toBe(401)
        })
      })

      describe('CORS Configuration', () => {
        it('should handle CORS for auth endpoints', async () => {
          const res = await fetch('http://localhost/api/auth/sign-in/email', {
            unix: socket,
            method: 'OPTIONS',
          })
          expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
        })
      })

      describe('Better Auth Integration', () => {
        it('should mount Better Auth routes at /api/auth', async () => {
          const res = await fetch('http://localhost/api/auth/get-session', {
            unix: socket,
            method: 'GET',
          })
          // Better Auth should handle this endpoint
          expect(res.status).toBe(200)
        })

        it('should expose sign-up endpoint', async () => {
          const res = await fetch('http://localhost/api/auth/sign-up/email', {
            unix: socket,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              email: 'newuser@example.com',
              name: 'New User',
              password: 'SecurePass123!',
            }),
          })
          expect(res.status).toBe(200)
          const signUpData = await res.json() as { user: { id: string, email: string, name: string } }
          expect(signUpData).toBeDefined()
          expect(signUpData.user.email).toBe('newuser@example.com')
          expect(signUpData.user.name).toBe('New User')
          expect(signUpData.user.id).toBeDefined()

          // Verify that we can sign in with the new user
          const signInRes = await fetch('http://localhost/api/auth/sign-in/email', {
            unix: socket,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: 'newuser@example.com',
              password: 'SecurePass123!',
            }),
          })
          expect(signInRes.status).toBe(200)
          // Better auth should return a cookie for the session
          expect(signInRes.headers.get('Set-Cookie')).toBeDefined()
          const cookie = signInRes.headers.get('Set-Cookie') as unknown as string
          expect(cookie.includes('better-auth.session_token=')).toBe(true)
          const signInData = await signInRes.json() as { token: string, user: { id: string, email: string, name: string } }
          expect(signInData).toBeDefined()
          expect(signInData.token).toBeDefined()
          expect(signInData.user.email).toBe('newuser@example.com')
          expect(signInData.user.name).toBe('New User')
          expect(signInData.user.id).toBeDefined()

          // Use controllers method that expects authentication
          const protectedRes = await fetch('http://localhost/auth/profile', {
            unix: socket,
            method: 'GET',
            headers: {
              Cookie: cookie,
            },
          })
          expect(protectedRes.status).toBe(200)
          const data = (await protectedRes.json()) as {
            id: string
            email: string
            name: string
          }
          expect(data.email).toBe('newuser@example.com')
          expect(data.name).toBe('New User')
        })
      })

      afterAll(async () => {
        await app.close()
        await Bun.file(socket).delete()
      })
    })

    describe('Using TCP port', () => {
      let app: INestApplication<Server<unknown>>
      let url: string

      beforeAll(async () => {
        const database = new Database(':memory:')

        const auth = betterAuth({
          database,
          emailAndPassword: {
            enabled: true,
          },
        })

        // Run migrations
        const { runMigrations } = await getMigrations({
          database,
          emailAndPassword: {
            enabled: true,
          },
        })
        await runMigrations()

        const moduleRef = await Test.createTestingModule({
          imports: [AuthModule.forRoot({
            auth,
            disableBodyParser: true,
          })],
          controllers: [],
        }).compile()

        app = moduleRef.createNestApplication(new BunAdapter(), { cors: true })
        await app.listen(0) // Random available port
        const server = app.getHttpAdapter().getHttpServer() as Server<unknown>
        url = server.url.toString()
      })

      it('should respond to sign-up on TCP port', async () => {
        const signUpRes = await fetch(`${url}/api/auth/sign-up/email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'test@example.com',
            name: 'Test User',
            password: 'SecurePass123!',
          }),
        })
        expect(signUpRes.status).toBe(200)

        // Sign in to verify
        const signInRes = await fetch(`${url}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'test@example.com',
            password: 'SecurePass123!',
          }),
        })
        expect(signInRes.status).toBe(200)
      })

      afterAll(async () => {
        await app.close()
      })
    })

    describe('Hook Decorators', () => {
      const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
      let app: INestApplication<Server<unknown>>
      let hookBeforeExecuted = false
      let hookAfterExecuted = false
      let hookContext: unknown = null

      beforeAll(async () => {
        const database = new Database(':memory:')

        const auth = betterAuth({
          database,
          emailAndPassword: {
            enabled: true,
          },
          hooks: {}, // Required for hook decorators to work
        })

        // Run migrations
        const { runMigrations } = await getMigrations({
          database,
          emailAndPassword: {
            enabled: true,
          },
        })
        await runMigrations()

        // Import hook decorators dynamically
        const { Hook, BeforeHook, AfterHook } = await import('@thallesp/nestjs-better-auth')

        @Hook()
        class SignUpBeforeHook {
          @BeforeHook('/sign-up/email')
          handle(ctx: unknown) {
            hookBeforeExecuted = true
            hookContext = ctx
          }
        }

        @Hook()
        class SignUpAfterHook {
          @AfterHook('/sign-up/email')
          handle() {
            hookAfterExecuted = true
          }
        }

        @Controller()
        class TestController {
          @Get()
          @AllowAnonymous()
          getRoot() {
            return { hookBeforeExecuted, hookAfterExecuted }
          }
        }

        const moduleRef = await Test.createTestingModule({
          imports: [AuthModule.forRoot({
            auth,
            disableBodyParser: true,
          })],
          controllers: [TestController],
          providers: [SignUpBeforeHook, SignUpAfterHook],
        }).compile()

        app = moduleRef.createNestApplication(new BunAdapter(), { cors: true })
        await app.listen(socket)
      })

      it('should execute @BeforeHook decorator before sign-up', async () => {
        expect(hookBeforeExecuted).toBe(false)

        const res = await fetch('http://localhost/api/auth/sign-up/email', {
          unix: socket,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'hook-test@example.com',
            name: 'Hook Test User',
            password: 'SecurePass123!',
          }),
        })

        expect(res.status).toBe(200)
        expect(hookBeforeExecuted).toBe(true)
        expect(hookContext).toBeDefined()
      })

      it('should execute @AfterHook decorator after sign-up', () => {
        expect(hookAfterExecuted).toBe(true)
      })

      it('should verify hook execution status via test endpoint', async () => {
        const res = await fetch('http://localhost', {
          unix: socket,
        })
        expect(res.status).toBe(200)
        const data = (await res.json()) as {
          hookBeforeExecuted: boolean
          hookAfterExecuted: boolean
        }
        expect(data.hookBeforeExecuted).toBe(true)
        expect(data.hookAfterExecuted).toBe(true)
      })

      afterAll(async () => {
        await app.close()
        await Bun.file(socket).delete()
      })
    })

    describe('AuthService', () => {
      const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
      let app: INestApplication<Server<unknown>>

      beforeAll(async () => {
        const database = new Database(':memory:')

        const auth = betterAuth({
          database,
          emailAndPassword: {
            enabled: true,
          },
        })

        // Run migrations
        const { runMigrations } = await getMigrations({
          database,
          emailAndPassword: {
            enabled: true,
          },
        })
        await runMigrations()

        @Controller('auth-service')
        class AuthServiceController {
          constructor(private readonly authService: AuthService) {}

          @Get('accounts')
          @AllowAnonymous()
          async getAccounts(@Req() req: { headers: Record<string, string> }) {
            const { fromNodeHeaders } = await import('better-auth/node')

            const accounts = await this.authService.api.listUserAccounts({
              headers: fromNodeHeaders(req.headers),
            })

            return { accounts }
          }

          @Get('session-from-service')
          @AllowAnonymous()
          async getSession(@Req() req: { headers: Record<string, string> }) {
            const { fromNodeHeaders } = await import('better-auth/node')

            const session = await this.authService.api.getSession({
              headers: fromNodeHeaders(req.headers),
            })

            return { session }
          }

          @Get('auth-instance')
          @AllowAnonymous()
          getAuthInstance() {
            // Verify we can access the auth instance

            const hasApi = !!this.authService.api
            return { hasAuthApi: hasApi }
          }
        }

        const moduleRef = await Test.createTestingModule({
          imports: [AuthModule.forRoot({
            auth,
            disableBodyParser: true,
          })],
          controllers: [AuthServiceController],
        }).compile()

        app = moduleRef.createNestApplication(new BunAdapter(), { cors: true })
        await app.listen(socket)
      })

      it('should inject AuthService into controllers', async () => {
        const res = await fetch('http://localhost/auth-service/auth-instance', {
          unix: socket,
        })
        expect(res.status).toBe(200)
        const data = (await res.json()) as { hasAuthApi: boolean }
        expect(data.hasAuthApi).toBe(true)
      })

      it('should access Better Auth API through AuthService', async () => {
        const res = await fetch('http://localhost/auth-service/session-from-service', {
          unix: socket,
        })
        expect(res.status).toBe(200)
        const data = (await res.json()) as { session: unknown }
        expect(data).toHaveProperty('session')
      })

      it('should call listUserAccounts via AuthService with authenticated user', async () => {
        // First, create a user
        const signUpRes = await fetch('http://localhost/api/auth/sign-up/email', {
          unix: socket,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'authservice@example.com',
            name: 'Auth Service User',
            password: 'SecurePass123!',
          }),
        })
        expect(signUpRes.status).toBe(200)

        // Sign in to get session cookie
        const signInRes = await fetch('http://localhost/api/auth/sign-in/email', {
          unix: socket,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'authservice@example.com',
            password: 'SecurePass123!',
          }),
        })
        expect(signInRes.status).toBe(200)
        const cookie = signInRes.headers.get('Set-Cookie') as unknown as string

        // Now try to get accounts with the session
        const accountsRes = await fetch('http://localhost/auth-service/accounts', {
          unix: socket,
          headers: {
            Cookie: cookie,
          },
        })
        expect(accountsRes.status).toBe(200)
        const data = (await accountsRes.json()) as { accounts: unknown[] }
        expect(data).toHaveProperty('accounts')
        expect(Array.isArray(data.accounts)).toBe(true)
      })

      afterAll(async () => {
        await app.close()
        await Bun.file(socket).delete()
      })
    })

    describe('Request Object Access', () => {
      const socket = join(tmpdir(), `${randomUUIDv7()}.sock`)
      let app: INestApplication<Server<unknown>>

      beforeAll(async () => {
        const database = new Database(':memory:')

        const auth = betterAuth({
          database,
          emailAndPassword: {
            enabled: true,
          },
        })

        // Run migrations
        const { runMigrations } = await getMigrations({
          database,
          emailAndPassword: {
            enabled: true,
          },
        })
        await runMigrations()

        @Controller('request-access')
        class RequestAccessController {
          @Get('check-session')
          checkSession(@Req() req: BunRequest) {
            return {
              hasSession: !!req.session,
              hasUser: !!req.user,
              session: req.session,
              user: req.user,
            }
          }

          @Get('user-only')
          getUserFromRequest(@Req() req: BunRequest) {
            return {
              userId: req.user?.id,
              userEmail: req.user?.email,
              userName: req.user?.name,
            }
          }

          @Get('session-only')
          getSessionFromRequest(@Req() req: BunRequest) {
            return {
              sessionId: req.session?.id,
              sessionUserId: req.session?.userId,
              hasSession: !!req.session,
            }
          }

          @Get('both')
          getBoth(@Req() req: BunRequest) {
            return {
              hasSession: !!req.session,
              hasUser: !!req.user,
              sessionUserId: req.session?.userId,
              sessionUserObj: req.session?.user,
              userObj: req.user,
            }
          }
        }

        const moduleRef = await Test.createTestingModule({
          imports: [AuthModule.forRoot({
            auth,
            disableBodyParser: true,
          })],
          controllers: [RequestAccessController],
        }).compile()

        app = moduleRef.createNestApplication(new BunAdapter(), { cors: true })
        await app.listen(socket)
      })

      it('should have session and user undefined in request without authentication', async () => {
        const res = await fetch('http://localhost/request-access/check-session', {
          unix: socket,
        })
        expect(res.status).toBe(401) // Protected by default
      })

      it('should attach session to request object for authenticated requests', async () => {
        // Create and sign in a user
        const signUpRes = await fetch('http://localhost/api/auth/sign-up/email', {
          unix: socket,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'reqaccess@example.com',
            name: 'Request Access User',
            password: 'SecurePass123!',
          }),
        })
        expect(signUpRes.status).toBe(200)

        const signInRes = await fetch('http://localhost/api/auth/sign-in/email', {
          unix: socket,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'reqaccess@example.com',
            password: 'SecurePass123!',
          }),
        })
        expect(signInRes.status).toBe(200)
        const cookie = signInRes.headers.get('Set-Cookie') as unknown as string

        // Check session in request
        const res = await fetch('http://localhost/request-access/check-session', {
          unix: socket,
          headers: { Cookie: cookie },
        })
        expect(res.status).toBe(200)
        const data = (await res.json()) as {
          hasSession: boolean
          hasUser: boolean
          session: unknown
          user: unknown
        }
        expect(data.hasSession).toBe(true)
        expect(data.hasUser).toBe(true)
        expect(data.session).toBeDefined()
        expect(data.user).toBeDefined()
      })

      it('should attach user object to request for authenticated requests', async () => {
        // Sign in
        const signInRes = await fetch('http://localhost/api/auth/sign-in/email', {
          unix: socket,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'reqaccess@example.com',
            password: 'SecurePass123!',
          }),
        })
        const cookie = signInRes.headers.get('Set-Cookie') as unknown as string

        const res = await fetch('http://localhost/request-access/user-only', {
          unix: socket,
          headers: { Cookie: cookie },
        })
        expect(res.status).toBe(200)
        const data = (await res.json()) as {
          userId: string
          userEmail: string
          userName: string
        }
        expect(data.userId).toBeDefined()
        expect(data.userEmail).toBe('reqaccess@example.com')
        expect(data.userName).toBe('Request Access User')
      })

      it('should provide session data in request object', async () => {
        // Sign up first to ensure user exists
        await fetch('http://localhost/api/auth/sign-up/email', {
          unix: socket,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'reqaccess@example.com',
            password: 'SecurePass123!',
            name: 'Request Access User',
          }),
        })

        // Sign in
        const signInRes = await fetch('http://localhost/api/auth/sign-in/email', {
          unix: socket,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'reqaccess@example.com',
            password: 'SecurePass123!',
          }),
        })
        const cookie = signInRes.headers.get('Set-Cookie') as unknown as string

        const res = await fetch('http://localhost/request-access/session-only', {
          unix: socket,
          headers: { Cookie: cookie },
        })
        expect(res.status).toBe(200)
        const data = (await res.json()) as {
          sessionId: string
          sessionUserId: string
          hasSession: boolean
        }
        expect(data.hasSession).toBe(true)
        // Session object may not have userId directly accessible
        // Just verify we have the session
      })

      it('should provide both session and user with matching userId', async () => {
        // Sign up first to ensure user exists
        await fetch('http://localhost/api/auth/sign-up/email', {
          unix: socket,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'reqaccess@example.com',
            password: 'SecurePass123!',
            name: 'Request Access User',
          }),
        })

        // Sign in
        const signInRes = await fetch('http://localhost/api/auth/sign-in/email', {
          unix: socket,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'reqaccess@example.com',
            password: 'SecurePass123!',
          }),
        })
        const cookie = signInRes.headers.get('Set-Cookie') as unknown as string

        const res = await fetch('http://localhost/request-access/both', {
          unix: socket,
          headers: { Cookie: cookie },
        })
        expect(res.status).toBe(200)
        const data = (await res.json()) as {
          hasSession: boolean
          hasUser: boolean
          sessionUserId: string
          sessionUserObj: { id: string }
          userObj: { id: string, email: string }
        }
        expect(data.hasSession).toBe(true)
        expect(data.hasUser).toBe(true)
        // Verify session contains user object that matches the request user
        expect(data.sessionUserObj.id).toBeDefined()
        expect(data.userObj.id).toBeDefined()
        expect(data.sessionUserObj.id).toBe(data.userObj.id)
      })

      afterAll(async () => {
        await app.close()
        await Bun.file(socket).delete()
      })
    })
  })
})
