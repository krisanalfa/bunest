import {
  CorsOptions,
  CorsOptionsDelegate,
} from '@nestjs/common/interfaces/external/cors-options.interface.js'
import {
  ErrorHandler,
  RequestHandler,
} from '@nestjs/common/interfaces/index.js'
import {
  Logger,
  NestApplicationOptions,
  RequestMethod,
  VersioningOptions,
} from '@nestjs/common'
import { BunRequest as NativeRequest, Serve, Server, randomUUIDv7 } from 'bun'
import { AbstractHttpAdapter } from '@nestjs/core'
import { VersionValue } from '@nestjs/common/interfaces/version-options.interface.js'

import { BunBodyParserMiddleware } from './bun.body-parser.middleware.js'
import { BunCorsMiddleware } from './bun.cors.middleware.js'
import { BunMiddlewareEngine } from './bun.middleware-engine.js'
import { BunRequest } from './bun.request.js'
import { BunResponse } from './bun.response.js'
import { BunVersionFilterMiddleware } from './bun.version-filter.middleware.js'

// Static method map - use direct string lookup for hot path
const REQUEST_METHOD_STRINGS: readonly string[] = [
  'GET', // 0
  'POST', // 1
  'PUT', // 2
  'DELETE', // 3
  'PATCH', // 4
  'ALL', // 5
  'OPTIONS', // 6
  'HEAD', // 7
  'SEARCH', // 8
  'PROPFIND', // 9
  'PROPPATCH', // 10
  'MKCOL', // 11
  'COPY', // 12
  'MOVE', // 13
  'LOCK', // 14
  'UNLOCK', // 15
]

type PathHandler = Partial<
  Record<
    Serve.HTTPMethod,
        Serve.Handler<NativeRequest, Server<unknown>, Response> | Response
  >
>

export class BunAdapter extends AbstractHttpAdapter<
  Server<unknown>,
  BunRequest,
  BunResponse
> {
  private readonly logger: Logger = new Logger('BunAdapter', { timestamp: true })
  private readonly middlewareEngine = new BunMiddlewareEngine()
  private useVersioning = false

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  private readonly routes: Record<string, PathHandler> = Object.create(null) // Use null prototype for faster lookup

  // Store multiple handlers per route/method for version chaining
  private readonly routeHandlers = new Map<
    string,
    RequestHandler<BunRequest, BunResponse>[]
  >()

  private notFoundHandler: RequestHandler<BunRequest, BunResponse> = (
    req,
    res,
  ) => {
    res.setStatus(404)
    res.end({ message: 'Not Found' })
  }

  constructor(private bunServeOptions: Pick<Serve.Options<unknown>, 'development' | 'maxRequestBodySize' | 'idleTimeout' | 'id' | 'tls'> = {
    development: false,
    id: randomUUIDv7(),
  }) {
    super()
  }

  use(middleware: RequestHandler<BunRequest, BunResponse>): void {
    this.middlewareEngine.useGlobal(middleware)
  }

  get(handler: RequestHandler<BunRequest, BunResponse>): void
  get(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  get(
    pathOrHandler: unknown,
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    const { path, handler } = this.parseRouteHandler(
      pathOrHandler,
      maybeHandler,
    )
    this.delegateRouteHandler('GET', path, handler)
  }

  post(handler: RequestHandler<BunRequest, BunResponse>): void
  post(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  post(
    pathOrHandler: unknown,
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    const { path, handler } = this.parseRouteHandler(
      pathOrHandler,
      maybeHandler,
    )
    this.delegateRouteHandler('POST', path, handler)
  }

  put(handler: RequestHandler<BunRequest, BunResponse>): void
  put(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  put(
    pathOrHandler: unknown,
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    const { path, handler } = this.parseRouteHandler(
      pathOrHandler,
      maybeHandler,
    )
    this.delegateRouteHandler('PUT', path, handler)
  }

  patch(handler: RequestHandler<BunRequest, BunResponse>): void
  patch(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  patch(
    pathOrHandler: unknown,
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    const { path, handler } = this.parseRouteHandler(
      pathOrHandler,
      maybeHandler,
    )
    this.delegateRouteHandler('PATCH', path, handler)
  }

  delete(handler: RequestHandler<BunRequest, BunResponse>): void
  delete(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  delete(
    pathOrHandler: unknown,
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    const { path, handler } = this.parseRouteHandler(
      pathOrHandler,
      maybeHandler,
    )
    this.delegateRouteHandler('DELETE', path, handler)
  }

  head(handler: RequestHandler<BunRequest, BunResponse>): void
  head(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  head(
    pathOrHandler: unknown,
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    const { path, handler } = this.parseRouteHandler(
      pathOrHandler,
      maybeHandler,
    )
    this.delegateRouteHandler('HEAD', path, handler)
  }

  options(handler: RequestHandler<BunRequest, BunResponse>): void
  options(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  options(
    pathOrHandler: unknown,
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    const { path, handler } = this.parseRouteHandler(
      pathOrHandler,
      maybeHandler,
    )
    this.delegateRouteHandler('OPTIONS', path, handler)
  }

  all(handler: RequestHandler<BunRequest, BunResponse>): void
  all(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  all(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    pathOrHandler: unknown,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    throw new Error('Not supported.')
  }

  propfind(handler: RequestHandler<BunRequest, BunResponse>): void
  propfind(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  propfind(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    pathOrHandler: unknown,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    throw new Error('Not supported.')
  }

  proppatch(handler: RequestHandler<BunRequest, BunResponse>): void
  proppatch(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  proppatch(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    pathOrHandler: unknown,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    throw new Error('Not supported.')
  }

  mkcol(handler: RequestHandler<BunRequest, BunResponse>): void
  mkcol(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  mkcol(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    pathOrHandler: unknown,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    throw new Error('Not supported.')
  }

  copy(handler: RequestHandler<BunRequest, BunResponse>): void
  copy(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  copy(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    pathOrHandler: unknown,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    throw new Error('Not supported.')
  }

  move(handler: RequestHandler<BunRequest, BunResponse>): void
  move(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  move(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    pathOrHandler: unknown,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    throw new Error('Not supported.')
  }

  lock(handler: RequestHandler<BunRequest, BunResponse>): void
  lock(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  lock(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    pathOrHandler: unknown,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    throw new Error('Not supported.')
  }

  unlock(handler: RequestHandler<BunRequest, BunResponse>): void
  unlock(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  unlock(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    pathOrHandler: unknown,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    throw new Error('Not supported.')
  }

  search(handler: RequestHandler<BunRequest, BunResponse>): void
  search(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  search(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    pathOrHandler: unknown,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    throw new Error('Not supported.')
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  useStaticAssets(...args: unknown[]) {
    throw new Error('Not supported.')
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setViewEngine(engine: string) {
    throw new Error('Not supported.')
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  render(response: unknown, view: string, options: unknown) {
    throw new Error('Not supported.')
  }

  async close() {
    await this.httpServer.stop()
  }

  initHttpServer(options: NestApplicationOptions) {
    // Set dummy server to satisfy AbstractHttpAdapter requirements
    this.setHttpServer({
      once: () => { /* noop: Nest use this to listen for "error" event */ },
      address: () => ({ address: '0.0.0.0', port: 0 }),
      removeListener: () => { /* noop: Nest may use this to remove "error" listener */ },
      stop: () => { /* noop */ },
    } as unknown as Server<unknown>)

    if (options.httpsOptions) {
      this.bunServeOptions.tls = {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        key: options.httpsOptions.key,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        cert: options.httpsOptions.cert,
        passphrase: options.httpsOptions.passphrase,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        ca: options.httpsOptions.ca,
        ciphers: options.httpsOptions.ciphers,
        secureOptions: options.httpsOptions.secureOptions,
        rejectUnauthorized: options.httpsOptions.rejectUnauthorized,
        requestCert: options.httpsOptions.requestCert,
      }
    }
  }

  getRequestHostname(request: BunRequest) {
    return request.hostname
  }

  getRequestMethod(request: BunRequest) {
    return request.method
  }

  getRequestUrl(request: BunRequest) {
    return request.pathname
  }

  status(response: BunResponse, statusCode: number) {
    response.setStatus(statusCode)
  }

  reply(response: BunResponse, body: unknown, statusCode?: number) {
    if (statusCode) {
      response.setStatus(statusCode)
    }

    response.end(body)
  }

  end(response: BunResponse, message?: string) {
    response.end(message)
  }

  redirect(response: BunResponse, statusCode: number, url: string) {
    response.redirect(url, statusCode)
  }

  setErrorHandler(
    handler: ErrorHandler<BunRequest, BunResponse>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    prefix?: string,
  ) {
    this.middlewareEngine.useErrorHandler(handler)
  }

  setNotFoundHandler(
    handler: RequestHandler<BunRequest, BunResponse>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    prefix?: string,
  ) {
    this.notFoundHandler = handler
    this.middlewareEngine.useNotFoundHandler(handler)
  }

  isHeadersSent(response: BunResponse): boolean {
    return response.isEnded()
  }

  getHeader(response: BunResponse, name: string): string | null {
    return response.getHeader(name)
  }

  setHeader(response: BunResponse, name: string, value: string) {
    response.setHeader(name, value)
  }

  appendHeader(response: BunResponse, name: string, value: string) {
    response.appendHeader(name, value)
  }

  registerParserMiddleware(prefix?: string, rawBody?: boolean) {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    this.logger.log(`Registering Body Parser Middleware with prefix: ${prefix || '/'} and rawBody: ${rawBody ? 'true' : 'false'}`)
    const bodyParser = new BunBodyParserMiddleware({ prefix, rawBody })
    this.middlewareEngine.useGlobal(bodyParser.run.bind(bodyParser))
  }

  enableCors(
    options?: CorsOptions | CorsOptionsDelegate<BunRequest>,
    prefix?: string,
  ) {
    this.logger.log(`Enabling CORS Middleware with prefix: ${prefix ?? '/'}`)
    const corsMiddleware = new BunCorsMiddleware({ corsOptions: options, prefix })
    this.middlewareEngine.useGlobal(corsMiddleware.run.bind(corsMiddleware))
  }

  createMiddlewareFactory(
    requestMethod: RequestMethod,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  ): (path: string, callback: Function) => void {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    return (path: string, callback: Function) => {
      // Map RequestMethod enum to string method name
      const methodName = this.mapRequestMethodToString(requestMethod)

      // Handle wildcard routes (applies to all paths)
      // NestJS uses "/*" or "*" for wildcard routes
      if (path === '*' || path === '/*') {
        this.middlewareEngine.useWildcard(
          methodName,
          callback as RequestHandler<BunRequest, BunResponse>,
        )
        return
      }

      // Normalize path by removing trailing slash (except for root "/")
      const normalizedPath = path === '/' ? path : path.replace(/\/$/, '')
      this.middlewareEngine.useRoute(
        methodName,
        normalizedPath,
        callback as RequestHandler<BunRequest, BunResponse>,
      )
    }
  }

  getType(): string {
    return 'bun'
  }

  applyVersionFilter(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    handler: Function,
    version: VersionValue,
    versioningOptions: VersioningOptions,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  ): (req: BunRequest, res: BunResponse, next: () => void) => Function {
    this.logger.log(`Applying Version Filter Middleware for version: ${JSON.stringify(version)}`)
    this.useVersioning = true
    return BunVersionFilterMiddleware.createFilter(
      handler as (req: BunRequest, res: BunResponse, next: () => void) => unknown,
      version,
      versioningOptions,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    ) as (req: BunRequest, res: BunResponse, next: () => void) => Function
  }

  /**
   * Start listening on the specified port and hostname.
   * @param port The port number or Unix socket path to listen on.
   * @param callback Optional callback to invoke once the server is listening.
   */
  listen(port: string | number, callback?: () => void): void
  /**
   * Start listening on the specified port and hostname.
   * @param port The port number or Unix socket path to listen on.
   * @param hostname The hostname to bind to.
   * @param callback Optional callback to invoke once the server is listening.
   */
  listen(port: string | number, hostname: string, callback?: () => void): void
  /**
   * Start listening on the specified port and hostname.
   * @param port The port number or Unix socket path to listen on.
   * @param hostnameOrCallback The hostname to bind to or the callback function.
   * @param maybeCallback Optional callback to invoke once the server is listening.
   */
  listen(
    port: string | number,
    hostnameOrCallback?: string | (() => void),
    maybeCallback?: () => void,
  ): void {
    const hostname
      = typeof hostnameOrCallback === 'string' ? hostnameOrCallback : 'localhost'
    const callback
      = typeof hostnameOrCallback === 'function'
        ? hostnameOrCallback
        : maybeCallback

    // Capture references for closure - avoid 'this' lookup in hot path
    const middlewareEngine = this.middlewareEngine
    const notFoundHandler = this.notFoundHandler

    const fetch = async (request: NativeRequest): Promise<Response> => {
      const bunRequest = new BunRequest(request)
      const bunResponse = new BunResponse()
      // Inline property access for hot path
      await middlewareEngine.run({
        req: bunRequest,
        res: bunResponse,
        method: bunRequest.method,
        path: bunRequest.pathname,
        requestHandler: notFoundHandler,
      })
      return bunResponse.res()
    }

    const omit = <T extends object, K extends keyof T>(
      obj: T,
      ...keys: K[]
    ): Omit<T, K> => {
      const result = { ...obj }
      for (const key of keys) {
        Reflect.deleteProperty(result, key)
      }
      return result
    }

    const server = typeof port === 'number' || !isNaN(Number(port))
      ? Bun.serve<unknown>({
          ...this.bunServeOptions,
          hostname,
          port,
          routes: this.routes,
          fetch,
        })
      : Bun.serve<unknown>({
          ...omit(this.bunServeOptions, 'idleTimeout'),
          unix: port,
          routes: this.routes,
          fetch,
        })

    if (typeof port === 'string' && isNaN(Number(port))) {
      this.logger.log(`Bun server listening on unix socket: ${port}`)
    }

    callback?.()

    // Add `address` method to match Node.js Server interface
    Object.defineProperty(server, 'address', {
      configurable: true,
      enumerable: true,
      get: () => ({ address: server.hostname, port: server.port }),
    })

    this.setHttpServer(server)
  }

  private delegateRouteHandler(
    method: Serve.HTTPMethod,
    path: string,
    handler: RequestHandler<BunRequest, BunResponse>,
  ): void {
    // Use null prototype object for route if not exists
    if (!(path in this.routes)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      this.routes[path] = Object.create(null)
    }

    const requestHandler = !this.useVersioning
      ? handler
      // Create handler that wraps array + fallback into a single callable
      // This avoids recreating the chained handler on every request
      : this.createChainedHandlerForVersioningResolution(
          this.createVersioningHandlers(method, path, handler),
          this.notFoundHandler,
        )

    this.routes[path][method] = async (request: NativeRequest): Promise<Response> => {
      const bunRequest = new BunRequest(request)
      const bunResponse = new BunResponse()

      await this.middlewareEngine.run({
        req: bunRequest,
        res: bunResponse,
        method,
        path,
        requestHandler,
      })

      return bunResponse.res()
    }
  }

  private createVersioningHandlers(
    method: Serve.HTTPMethod,
    path: string,
    handler: RequestHandler<BunRequest, BunResponse>,
  ) {
    // Store handler in the handlers array for chaining (versioning support)
    const routeKey = `${method}:${path}`
    let versioningHandlers = this.routeHandlers.get(routeKey)
    if (!versioningHandlers) {
      versioningHandlers = []
      this.routeHandlers.set(routeKey, versioningHandlers)
    }
    versioningHandlers.push(handler)

    return versioningHandlers
  }

  private async executeHandlerChain(
    handlers: RequestHandler<BunRequest, BunResponse>[],
    req: BunRequest,
    res: BunResponse,
  ): Promise<void> {
    const handlersLength = handlers.length
    let index = 0
    let shouldContinue = true

    while (shouldContinue && index < handlersLength && !res.isEnded()) {
      shouldContinue = false
      const currentIndex = index++
      const result = handlers[currentIndex](req, res, () => {
        shouldContinue = true
      }) as unknown
      if (result instanceof Promise) await result
    }
  }

  private createChainedHandlerForVersioningResolution(
    handlers: RequestHandler<BunRequest, BunResponse>[],
    notFoundHandler: RequestHandler<BunRequest, BunResponse>,
  ): RequestHandler<BunRequest, BunResponse> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    return (async (req: BunRequest, res: BunResponse, next?: Function): Promise<void> => {
      // First pass: discovery for versioning
      await this.executeHandlerChain(handlers, req, res)

      // Check for custom versioning candidates
      if (!res.isEnded() && BunVersionFilterMiddleware.hasCustomVersioningCandidates(req)) {
        const bestVersion = BunVersionFilterMiddleware.selectBestCustomVersionCandidate(req)

        if (bestVersion) {
          BunVersionFilterMiddleware.setCustomVersioningExecutionPhase(req, bestVersion)
          await this.executeHandlerChain(handlers, req, res)
        }
      }

      // If still not handled, call not found handler
      if (!res.isEnded()) {
        notFoundHandler(req, res, next)
      }
    }) as RequestHandler<BunRequest, BunResponse>
  }

  private mapRequestMethodToString(requestMethod: RequestMethod): string {
    return REQUEST_METHOD_STRINGS[requestMethod] ?? 'ALL'
  }

  private parseRouteHandler(handler: RequestHandler<BunRequest, BunResponse>): {
    path: string
    handler: RequestHandler<BunRequest, BunResponse>
  }
  private parseRouteHandler(
    path: unknown,
    handler?: RequestHandler<BunRequest, BunResponse>,
  ): { path: string, handler: RequestHandler<BunRequest, BunResponse> }
  private parseRouteHandler(
    pathOrHandler: unknown,
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): { path: string, handler: RequestHandler<BunRequest, BunResponse> } {
    const path = typeof pathOrHandler === 'string' ? pathOrHandler : '/'
    const handler
      = typeof pathOrHandler === 'function'
        ? (pathOrHandler as RequestHandler<BunRequest, BunResponse>)
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        : maybeHandler!
    return { path, handler }
  }
}
