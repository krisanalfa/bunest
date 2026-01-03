import {
  CorsOptions,
  CorsOptionsDelegate,
} from '@nestjs/common/interfaces/external/cors-options.interface.js'
import {
  ErrorHandler,
  RequestHandler,
} from '@nestjs/common/interfaces/index.js'
import { HeadersInit, BunRequest as NativeRequest, Serve, Server, ServerWebSocket, randomUUIDv7 } from 'bun'
import {
  Logger,
  NestApplicationOptions,
  RequestMethod,
  VersioningOptions,
} from '@nestjs/common'
import { AbstractHttpAdapter } from '@nestjs/core'
import { VersionValue } from '@nestjs/common/interfaces/version-options.interface.js'

import { ServerOptions, WsOptions } from './internal.types.js'
import { BunBodyParserMiddleware } from './bun.body-parser.middleware.js'
import { BunCorsMiddleware } from './bun.cors.middleware.js'
import { BunMiddlewareEngine } from './bun.middleware-engine.js'
import { BunPreflightHttpServer } from './bun.preflight-http-server.js'
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

  // WebSocket support
  private readonly wsHandlers = {
    onOpen: undefined as ((ws: ServerWebSocket<unknown>) => void) | undefined,
    onMessage: undefined as ((ws: ServerWebSocket<unknown>, message: string | ArrayBuffer | Buffer | Buffer[], server: Server<unknown>) => void) | undefined,
    onClose: undefined as ((ws: ServerWebSocket<unknown>, code: number, reason: string) => void) | undefined,
  }

  private readonly wsMiddlewareEngine = new BunMiddlewareEngine()
  private wsOptions: WsOptions = {}
  private useWs = false
  private useWsCors = false
  private wsCorsHeaders?: HeadersInit

  constructor(protected bunServeOptions: ServerOptions = {
    development: false,
    id: randomUUIDv7(),
  }) {
    super()
    this.setInstance({
      // Some libraries try to register middleware via `app.use(...)`
      use: (maybePath: string | RequestHandler<BunRequest, BunResponse>, maybeHandler?: RequestHandler<BunRequest, BunResponse>): void => {
        if (typeof maybePath === 'string') {
          let path = maybePath
          const handler = maybeHandler
          if (!handler) {
            throw new Error('Handler must be provided when path is a string.')
          }
          // Normalize wildcard patterns like /api/auth/* or /api/auth/*path
          // Strip trailing /* or /*anything to treat as prefix match
          if (path.includes('/*')) {
            path = path.substring(0, path.indexOf('/*'))
          }
          this.logger.log(`Registering middleware for path: ${path}`)
          this.middlewareEngine.useRoute('ALL', path, handler)
        }
        else {
          const handler = maybePath
          this.middlewareEngine.useGlobal(handler)
        }
      },
    })
  }

  use(middleware: RequestHandler<BunRequest, BunResponse>): void {
    this.middlewareEngine.useGlobal(middleware)
  }

  // Generic method handler factory to reduce DRY
  private createHttpMethodHandler(httpMethod: Serve.HTTPMethod) {
    return (
      pathOrHandler: unknown,
      maybeHandler?: RequestHandler<BunRequest, BunResponse>,
    ): void => {
      const { path, handler } = this.parseRouteHandler(
        pathOrHandler,
        maybeHandler,
      )
      this.delegateRouteHandler(httpMethod, path, handler)
    }
  }

  get(handler: RequestHandler<BunRequest, BunResponse>): void
  get(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  get(
    pathOrHandler: unknown,
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    this.createHttpMethodHandler('GET')(pathOrHandler, maybeHandler)
  }

  post(handler: RequestHandler<BunRequest, BunResponse>): void
  post(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  post(
    pathOrHandler: unknown,
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    this.createHttpMethodHandler('POST')(pathOrHandler, maybeHandler)
  }

  put(handler: RequestHandler<BunRequest, BunResponse>): void
  put(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  put(
    pathOrHandler: unknown,
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    this.createHttpMethodHandler('PUT')(pathOrHandler, maybeHandler)
  }

  patch(handler: RequestHandler<BunRequest, BunResponse>): void
  patch(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  patch(
    pathOrHandler: unknown,
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    this.createHttpMethodHandler('PATCH')(pathOrHandler, maybeHandler)
  }

  delete(handler: RequestHandler<BunRequest, BunResponse>): void
  delete(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  delete(
    pathOrHandler: unknown,
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    this.createHttpMethodHandler('DELETE')(pathOrHandler, maybeHandler)
  }

  head(handler: RequestHandler<BunRequest, BunResponse>): void
  head(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  head(
    pathOrHandler: unknown,
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    this.createHttpMethodHandler('HEAD')(pathOrHandler, maybeHandler)
  }

  options(handler: RequestHandler<BunRequest, BunResponse>): void
  options(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  options(
    pathOrHandler: unknown,
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    this.createHttpMethodHandler('OPTIONS')(pathOrHandler, maybeHandler)
  }

  // Helper to create unsupported method stubs
  private createUnsupportedMethod() {
    return (
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      pathOrHandler: unknown,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      maybeHandler?: RequestHandler<BunRequest, BunResponse>,
    ): void => {
      throw new Error('Not supported.')
    }
  }

  all(handler: RequestHandler<BunRequest, BunResponse>): void
  all(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  all(
    pathOrHandler: unknown,
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    this.createUnsupportedMethod()(pathOrHandler, maybeHandler)
  }

  propfind(handler: RequestHandler<BunRequest, BunResponse>): void
  propfind(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  propfind(
    pathOrHandler: unknown,
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    this.createUnsupportedMethod()(pathOrHandler, maybeHandler)
  }

  proppatch(handler: RequestHandler<BunRequest, BunResponse>): void
  proppatch(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  proppatch(
    pathOrHandler: unknown,
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    this.createUnsupportedMethod()(pathOrHandler, maybeHandler)
  }

  mkcol(handler: RequestHandler<BunRequest, BunResponse>): void
  mkcol(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  mkcol(
    pathOrHandler: unknown,
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    this.createUnsupportedMethod()(pathOrHandler, maybeHandler)
  }

  copy(handler: RequestHandler<BunRequest, BunResponse>): void
  copy(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  copy(
    pathOrHandler: unknown,
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    this.createUnsupportedMethod()(pathOrHandler, maybeHandler)
  }

  move(handler: RequestHandler<BunRequest, BunResponse>): void
  move(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  move(
    pathOrHandler: unknown,
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    this.createUnsupportedMethod()(pathOrHandler, maybeHandler)
  }

  lock(handler: RequestHandler<BunRequest, BunResponse>): void
  lock(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  lock(
    pathOrHandler: unknown,
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    this.createUnsupportedMethod()(pathOrHandler, maybeHandler)
  }

  unlock(handler: RequestHandler<BunRequest, BunResponse>): void
  unlock(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  unlock(
    pathOrHandler: unknown,
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    this.createUnsupportedMethod()(pathOrHandler, maybeHandler)
  }

  search(handler: RequestHandler<BunRequest, BunResponse>): void
  search(path: unknown, handler: RequestHandler<BunRequest, BunResponse>): void
  search(
    pathOrHandler: unknown,
    maybeHandler?: RequestHandler<BunRequest, BunResponse>,
  ): void {
    this.createUnsupportedMethod()(pathOrHandler, maybeHandler)
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
    const preflightServer = new BunPreflightHttpServer({
      getBunHttpServerInstance: () => this.getHttpServer(),
      getBunServerOptions: () => this.bunServeOptions,
      getWsHandlers: () => this.wsHandlers,
      setWsOptions: (wsOptions: WsOptions) => {
        this.wsOptions = wsOptions
      },
    })
    // Hack to set the http server instance before listen is called
    this.setHttpServer(preflightServer as unknown as Server<unknown>)

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

    return preflightServer
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
      = typeof hostnameOrCallback === 'string' ? hostnameOrCallback : (this.bunServeOptions.hostname ?? '127.0.0.1')
    const callback
      = typeof hostnameOrCallback === 'function'
        ? hostnameOrCallback
        : maybeCallback

    // Capture references for closure - avoid 'this' lookup in hot path
    const middlewareEngine = this.middlewareEngine
    const notFoundHandler = this.notFoundHandler
    const wsHandlers = this.wsHandlers
    const bunServeOptions = this.bunServeOptions

    // Setup WebSocket if needed
    this.setupWebSocketIfNeeded(wsHandlers, bunServeOptions)

    const fetch = async (request: NativeRequest, server: Server<unknown>): Promise<Response> => {
      // Just in case we don't have any controllers/routes registered, this will handle websocket upgrade requests
      if (await this.upgradeWebSocket(request, server)) {
        return undefined as unknown as Response
      }

      const bunRequest = new BunRequest(request)
      const bunResponse = new BunResponse()
      // Find the actual route handler or fall back to notFoundHandler
      const routeHandler = middlewareEngine.findRouteHandler(bunRequest.method, bunRequest.pathname) ?? notFoundHandler
      // Inline property access for hot path
      await middlewareEngine.run({
        req: bunRequest,
        res: bunResponse,
        method: bunRequest.method,
        path: bunRequest.pathname,
        requestHandler: routeHandler,
      })
      return bunResponse.res()
    }

    const server = this.createServer(port, hostname, bunServeOptions, fetch)
    callback?.()
    this.setHttpServer(server)
  }

  private static isNumericPort(value: string | number): value is number {
    return typeof value === 'number' || !isNaN(Number(value))
  }

  private static omitKeys<T extends object, K extends keyof T>(
    obj: T,
    ...keys: K[]
  ): Omit<T, K> {
    const result = { ...obj }
    for (const key of keys) {
      Reflect.deleteProperty(result, key)
    }
    return result
  }

  private isWebSocketUpgradeRequest(request: NativeRequest): boolean {
    const upgradeHeader = request.headers.get('upgrade')
    const connectionHeader = request.headers.get('connection')
    return !!(
      upgradeHeader?.toLowerCase() === 'websocket'
      && connectionHeader?.toLowerCase().includes('upgrade')
    )
  }

  private async handleWebSocketCors(
    request: NativeRequest,
  ): Promise<HeadersInit> {
    // Cache CORS headers to avoid regenerating for every upgrade
    if (this.wsCorsHeaders) {
      return this.wsCorsHeaders
    }

    const bunRequest = new BunRequest(request)
    const bunResponse = new BunResponse()
    await this.wsMiddlewareEngine.run({
      req: bunRequest,
      res: bunResponse,
      method: bunRequest.method,
      path: bunRequest.pathname,
      requestHandler: (req, res) => {
        res.end()
      },
    })
    const response = await bunResponse.res()
    this.wsCorsHeaders = response.headers
    return this.wsCorsHeaders
  }

  private async upgradeWebSocket(
    request: NativeRequest,
    server: Server<unknown>,
  ): Promise<boolean> {
    if (!this.useWs || !this.isWebSocketUpgradeRequest(request)) {
      return false
    }

    if (!this.useWsCors) {
      return server.upgrade(
        request, {
          data: this.wsOptions.clientDataFactory
            ? this.wsOptions.clientDataFactory(new BunRequest(request))
            : {},
        },
      )
    }

    const headers = await this.handleWebSocketCors(request)
    return server.upgrade(
      request, {
        headers,
        data: this.wsOptions.clientDataFactory
          ? this.wsOptions.clientDataFactory(new BunRequest(request))
          : {},
      },
    )
  }

  private setupWebSocketIfNeeded(
    wsHandlers: typeof this.wsHandlers,
    bunServeOptions: ServerOptions,
  ): void {
    const useWs = !!wsHandlers.onOpen && !!wsHandlers.onMessage && !!wsHandlers.onClose
    this.useWs = useWs

    if (useWs) {
      // Cache server reference to avoid repeated lookups
      const getServer = this.getHttpServer.bind(this)
      const onMessage = wsHandlers.onMessage
      const onOpen = wsHandlers.onOpen
      const onClose = wsHandlers.onClose

      bunServeOptions.websocket = {
        ...this.wsOptions,
        message: (ws: ServerWebSocket<{
          onMessageInternal?: (message: string | Buffer) => void
        }>, message: string | Buffer) => {
          // Call client-specific handler first if exists
          ws.data.onMessageInternal?.(message)
          // Then call global handler (for NestJS framework)
          onMessage?.(ws, message, getServer())
        },
        open: (ws) => {
          onOpen?.(ws)
        },
        close: (ws: ServerWebSocket<{
          onCloseInternal?: () => void
          onDisconnect?: (ws: ServerWebSocket<unknown>) => void
        }>, code, reason) => {
          // Call client-specific handlers
          ws.data.onCloseInternal?.()
          ws.data.onDisconnect?.(ws)
          // Then call global handler (for NestJS framework)
          onClose?.(ws, code, reason)
        },
      }
    }

    const useWsCors = typeof this.wsOptions.cors !== 'undefined'
    this.useWsCors = useWsCors
    if (useWsCors) {
      const corsMiddleware = new BunCorsMiddleware({
        corsOptions:
          this.wsOptions.cors === true ? undefined : this.wsOptions.cors,
      })
      this.wsMiddlewareEngine.useGlobal(corsMiddleware.run.bind(corsMiddleware))
    }
  }

  private createServer(
    port: string | number,
    hostname: string,
    bunServeOptions: ServerOptions,
    fetch: (request: NativeRequest, server: Server<unknown>) => Promise<Response>,
  ): Server<unknown> {
    return BunAdapter.isNumericPort(port)
      ? Bun.serve<unknown>({
          ...bunServeOptions,
          hostname,
          port,
          routes: this.routes,
          fetch,
        })
      : Bun.serve<unknown>({
          ...BunAdapter.omitKeys(bunServeOptions, 'idleTimeout', 'port', 'hostname'),
          unix: port,
          routes: this.routes,
          fetch,
        })
  }

  private delegateRouteHandler(
    method: Serve.HTTPMethod,
    path: string,
    handler: RequestHandler<BunRequest, BunResponse>,
  ): void {
    this.ensureRouteExists(path)
    const requestHandler = this.prepareRequestHandler(method, path, handler)
    this.routes[path][method] = this.createRouteFetchHandler(
      path,
      method,
      requestHandler,
    )
  }

  private ensureRouteExists(path: string): void {
    if (!(path in this.routes)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      this.routes[path] = Object.create(null)
    }
  }

  private prepareRequestHandler(
    method: Serve.HTTPMethod,
    path: string,
    handler: RequestHandler<BunRequest, BunResponse>,
  ): RequestHandler<BunRequest, BunResponse> {
    if (!this.useVersioning) {
      return handler
    }
    // Create handler that wraps array + fallback into a single callable
    // This avoids recreating the chained handler on every request
    return this.createChainedHandlerForVersioningResolution(
      this.createVersioningHandlers(method, path, handler),
      this.notFoundHandler,
    )
  }

  private createRouteFetchHandler(
    path: string,
    method: Serve.HTTPMethod,
    requestHandler: RequestHandler<BunRequest, BunResponse>,
  ): (request: NativeRequest, server: Server<unknown>) => Promise<Response> {
    return async (
      request: NativeRequest,
      server: Server<unknown>,
    ): Promise<Response> => {
      // Just in case we have controllers/routes registered, this will handle websocket upgrade requests, but only for root path
      if (path === '/' && (await this.upgradeWebSocket(request, server))) {
        return undefined as unknown as Response
      }

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
