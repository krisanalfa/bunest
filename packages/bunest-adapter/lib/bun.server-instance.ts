import {
  CorsOptions,
  CorsOptionsDelegate,
} from '@nestjs/common/interfaces/external/cors-options.interface.js'
import { Logger, RequestMethod } from '@nestjs/common'
import { BunRequest as NativeRequest, Serve, Server, ServerWebSocket, WebSocketHandler, randomUUIDv7 } from 'bun'
import { BaseWsInstance } from '@nestjs/websockets'
import { join } from 'node:path'
import { readdir } from 'node:fs/promises'

import { BunMiddlewareEngine, BunRequestHandler } from './bun.middleware-engine.js'
import { BunStaticAssetsOptions, BunWsClientData, GraphQLWsOptions, ServerOptions, WsData, WsHandlers, WsOptions } from './bun.internal.types.js'
import { BunBodyParserMiddleware } from './bun.body-parser.middleware.js'
import { BunCorsMiddleware } from './bun.cors.middleware.js'
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

/**
 * BunServerInstance is the actual server instance that handles route registrations,
 * WebSocket functionalities, and the listen method. This class is passed to
 * AbstractHttpAdapter.setInstance() and implements the methods that NestJS expects
 * from an HTTP server instance (similar to Express app or Fastify instance).
 *
 * This class also implements BaseWsInstance to be compatible with NestJS WebSocket adapters.
 */
export class BunServerInstance implements BaseWsInstance {
  private readonly logger: Logger = new Logger('BunServerInstance', { timestamp: true })
  private readonly middlewareEngine = new BunMiddlewareEngine()
  private bunBodyParserMiddleware: BunBodyParserMiddleware | null = null
  private useVersioning = false

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  private readonly routes: Record<string, PathHandler> = Object.create(null) // Use null prototype for faster lookup

  // Store multiple handlers per route/method for version chaining
  private readonly routeHandlers = new Map<
    string,
    BunRequestHandler[]
  >()

  private notFoundHandler: BunRequestHandler = (
    req,
    res,
  ) => {
    res.setStatus(404)
    res.end({ message: 'Not Found' })
  }

  // WebSocket support
  private readonly wsHandlers: WsHandlers = {
    onOpen: undefined,
    onMessage: undefined,
    onClose: undefined,
  }

  private readonly wsMiddlewareEngine = new BunMiddlewareEngine()
  private wsOptions: WsOptions = {}
  private useWs = false
  private useWsCors = false

  // Static assets serving
  private staticAssetsOptions: {
    path: string
    options?: BunStaticAssetsOptions
  } | null = null

  // Server instance
  private httpServer: Server<unknown> | null = null

  constructor(private readonly bunServeOptions: ServerOptions<BunWsClientData>) {}

  // ============================================
  // Route Registration Methods (for NestJS instance proxy)
  // ============================================

  use(
    maybePath: string | BunRequestHandler,
    maybeHandler?: BunRequestHandler,
  ): void {
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
  }

  // Generic method handler factory to reduce DRY
  private createHttpMethodHandler(httpMethod: Serve.HTTPMethod) {
    return (
      pathOrHandler: unknown,
      maybeHandler?: BunRequestHandler,
    ): void => {
      const { path, handler } = this.parseRouteHandler(
        pathOrHandler,
        maybeHandler,
      )
      this.delegateRouteHandler(httpMethod, path, handler)
    }
  }

  get(
    pathOrHandler: unknown,
    maybeHandler?: BunRequestHandler,
  ): void {
    this.createHttpMethodHandler('GET')(pathOrHandler, maybeHandler)
  }

  post(
    pathOrHandler: unknown,
    maybeHandler?: BunRequestHandler,
  ): void {
    this.createHttpMethodHandler('POST')(pathOrHandler, maybeHandler)
  }

  /**
   * @internal
   * @param path
   * @param handler
   */
  nativePost(path: string, handler: Serve.Handler<NativeRequest, Server<unknown>, Response>): void {
    this.ensureRouteExists(path)
    this.routes[path].POST = handler
  }

  /**
   * @internal
   * @param path
   * @param handler
   */
  nativeGet(path: string, handler: Serve.Handler<NativeRequest, Server<unknown>, Response>): void {
    this.ensureRouteExists(path)
    this.routes[path].GET = handler
  }

  nativeOptions(path: string, handler: Serve.Handler<NativeRequest, Server<unknown>, Response>): void {
    this.ensureRouteExists(path)
    this.routes[path].OPTIONS = handler
  }

  put(
    pathOrHandler: unknown,
    maybeHandler?: BunRequestHandler,
  ): void {
    this.createHttpMethodHandler('PUT')(pathOrHandler, maybeHandler)
  }

  patch(
    pathOrHandler: unknown,
    maybeHandler?: BunRequestHandler,
  ): void {
    this.createHttpMethodHandler('PATCH')(pathOrHandler, maybeHandler)
  }

  delete(
    pathOrHandler: unknown,
    maybeHandler?: BunRequestHandler,
  ): void {
    this.createHttpMethodHandler('DELETE')(pathOrHandler, maybeHandler)
  }

  head(
    pathOrHandler: unknown,
    maybeHandler?: BunRequestHandler,
  ): void {
    this.createHttpMethodHandler('HEAD')(pathOrHandler, maybeHandler)
  }

  options(
    pathOrHandler: unknown,
    maybeHandler?: BunRequestHandler,
  ): void {
    this.createHttpMethodHandler('OPTIONS')(pathOrHandler, maybeHandler)
  }

  // Helper to create unsupported method stubs
  private createUnsupportedMethod() {
    return (
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      pathOrHandler: unknown,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      maybeHandler?: BunRequestHandler,
    ): void => {
      throw new Error('Not supported.')
    }
  }

  all(
    pathOrHandler: unknown,
    maybeHandler?: BunRequestHandler,
  ): void {
    this.createUnsupportedMethod()(pathOrHandler, maybeHandler)
  }

  propfind(
    pathOrHandler: unknown,
    maybeHandler?: BunRequestHandler,
  ): void {
    this.createUnsupportedMethod()(pathOrHandler, maybeHandler)
  }

  proppatch(
    pathOrHandler: unknown,
    maybeHandler?: BunRequestHandler,
  ): void {
    this.createUnsupportedMethod()(pathOrHandler, maybeHandler)
  }

  mkcol(
    pathOrHandler: unknown,
    maybeHandler?: BunRequestHandler,
  ): void {
    this.createUnsupportedMethod()(pathOrHandler, maybeHandler)
  }

  copy(
    pathOrHandler: unknown,
    maybeHandler?: BunRequestHandler,
  ): void {
    this.createUnsupportedMethod()(pathOrHandler, maybeHandler)
  }

  move(
    pathOrHandler: unknown,
    maybeHandler?: BunRequestHandler,
  ): void {
    this.createUnsupportedMethod()(pathOrHandler, maybeHandler)
  }

  lock(
    pathOrHandler: unknown,
    maybeHandler?: BunRequestHandler,
  ): void {
    this.createUnsupportedMethod()(pathOrHandler, maybeHandler)
  }

  unlock(
    pathOrHandler: unknown,
    maybeHandler?: BunRequestHandler,
  ): void {
    this.createUnsupportedMethod()(pathOrHandler, maybeHandler)
  }

  search(
    pathOrHandler: unknown,
    maybeHandler?: BunRequestHandler,
  ): void {
    this.createUnsupportedMethod()(pathOrHandler, maybeHandler)
  }

  // ============================================
  // Listen Method
  // ============================================

  /**
   * Start listening on the specified port and hostname.
   * @param port The port number or Unix socket path to listen on.
   * @param hostnameOrCallback The hostname to bind to or the callback function.
   * @param maybeCallback Optional callback to invoke once the server is listening.
   */
  async listen(
    port: string | number,
    hostnameOrCallback?: string | (() => void),
    maybeCallback?: () => void,
  ): Promise<Server<unknown>> {
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

    // Setup static assets if needed
    await this.setupStaticAssetsIfNeeded()

    // Setup WebSocket if needed
    this.setupWebSocketIfNeeded(wsHandlers, bunServeOptions)

    const fetch = async (request: NativeRequest, server: Server<unknown>): Promise<Response> => {
      const bunRequest = new BunRequest(request, server)
      // Just in case we don't have any controllers/routes registered, this will handle websocket upgrade requests
      if (await this.upgrade(request, bunRequest)) {
        return undefined as unknown as Response
      }

      // Find the actual route handler or fall back to notFoundHandler
      const routeHandler = middlewareEngine.findRouteHandler(bunRequest.method, bunRequest.pathname) ?? notFoundHandler
      // Inline property access for hot path
      const bunResponse = await middlewareEngine.run({
        req: bunRequest,
        res: new BunResponse(),
        method: bunRequest.method,
        path: bunRequest.pathname,
        requestHandler: routeHandler,
      })
      return bunResponse.res()
    }

    this.configureBunServerOptionsDefaults(bunServeOptions)
    this.httpServer = this.createServer(port, hostname, bunServeOptions, fetch)
    callback?.()
    return this.httpServer
  }

  private configureBunServerOptionsDefaults(
    bunServeOptions: ServerOptions,
  ): void {
    bunServeOptions.development ??= false
    bunServeOptions.id ??= randomUUIDv7()
  }

  /**
   * NestJS compatibility methods - stop the server
   */
  async stop(force?: boolean): Promise<void> {
    const server = this.httpServer
    if (!server) {
      // If the server is still a dummy or itself, there's nothing to stop
      return
    }
    await server.stop(force)
  }

  /**
   * Get the address of the server
   */
  address(): { address: string, port: number } {
    const server = this.httpServer
    if (!server) {
      const hostname = this.bunServeOptions.hostname
      const port = this.bunServeOptions.port
      return {
        address: typeof hostname === 'string' ? hostname : '127.0.0.1',
        port: typeof port === 'number' ? port : 3000,
      }
    }

    return {
      address: server.hostname ?? '127.0.0.1',
      port: server.port ?? 3000,
    }
  }

  // ============================================
  // BaseWsInstance Implementation (NestJS compatibility)
  // ============================================

  /**
   * NestJS compatibility method for event handling
   * Required by BaseWsInstance interface
   */
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type, @typescript-eslint/no-unused-vars
  on(event: string, callback: Function): void {
    // Bun servers don't use event-based patterns like Node.js
    // This is a no-op for compatibility
    this.logger.debug(`Event listener registered for: ${event}`)
  }

  /**
   * NestJS compatibility method for one-time event handling
   * Used by NestJS to listen for "error" events during HTTP server initialization
   */
  once(): void {
    // no operation
  }

  /**
   * NestJS compatibility method for removing event listeners
   * Used by NestJS to remove "error" event listeners during HTTP server cleanup
   */
  removeListener(): void {
    // no operation
  }

  /**
   * Close the server (BaseWsInstance implementation)
   * Proxy method for WebSocket server close
   */
  async close(): Promise<void> {
    await this.stop(true)
  }

  /**
   * Set WebSocket options
   */
  setWsOptions(options: WsOptions): void {
    this.wsOptions = options
  }

  /**
   * Register WebSocket open handler
   */
  registerWsOpenHandler(handler: (ws: ServerWebSocket<unknown>) => void): void {
    this.wsHandlers.onOpen = handler
  }

  /**
   * Register WebSocket message handler
   */
  registerWsMessageHandler(handler: (ws: ServerWebSocket<unknown>, message: WsData, server: Server<unknown>) => void): void {
    this.wsHandlers.onMessage = handler
  }

  /**
   * Register WebSocket close handler
   */
  registerWsCloseHandler(handler: (ws: ServerWebSocket<unknown>, code: number, reason: string) => void): void {
    this.wsHandlers.onClose = handler
  }

  /**
   * Get the underlying Bun server
   */
  getBunServer(): Server<unknown> | null {
    return this.httpServer
  }

  // ============================================
  // Middleware & Parser Registration
  // ============================================

  /**
   * Get the middleware engine
   */
  getMiddlewareEngine(): BunMiddlewareEngine {
    return this.middlewareEngine
  }

  /**
   * Set the not found handler
   */
  setNotFoundHandler(handler: BunRequestHandler): void {
    this.notFoundHandler = handler
  }

  /**
   * Enable versioning support
   */
  setUseVersioning(value: boolean): void {
    this.useVersioning = value
  }

  setWsHandlers<TWebSocketData = BunWsClientData>(handlers: GraphQLWsOptions<TWebSocketData>): void {
    this.bunServeOptions.withGraphQL = handlers as unknown as WebSocketHandler<BunWsClientData>
  }

  skipParserMiddleware(path: string): void {
    this.bunBodyParserMiddleware?.skip(path)
  }

  /**
   * Register body parser middleware
   */
  registerParserMiddleware(prefix?: string, rawBody?: boolean): void {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    this.logger.log(`Registering Body Parser Middleware with prefix: ${prefix || '/'} and rawBody: ${rawBody ? 'true' : 'false'}`)
    this.bunBodyParserMiddleware = new BunBodyParserMiddleware({ prefix, rawBody })
    this.middlewareEngine.useGlobal(this.bunBodyParserMiddleware.run.bind(this.bunBodyParserMiddleware))
  }

  /**
   * Create middleware factory for NestJS
   */
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
          callback as BunRequestHandler,
        )
        return
      }

      // Normalize path by removing trailing slash (except for root "/")
      const normalizedPath = path === '/' ? path : path.replace(/\/$/, '')
      this.middlewareEngine.useRoute(
        methodName,
        normalizedPath,
        callback as BunRequestHandler,
      )
    }
  }

  /**
   * Enable CORS middleware
   */
  enableCors(
    corsOptions?: CorsOptions | CorsOptionsDelegate<BunRequest>,
    prefix?: string,
  ): void {
    this.logger.log(`Enabling CORS Middleware with prefix: ${prefix ?? '/'}`)
    const corsMiddleware = new BunCorsMiddleware({ corsOptions, prefix })
    this.middlewareEngine.useGlobal(corsMiddleware.run.bind(corsMiddleware))
  }

  /**
   * Serve static assets
   */
  useStaticAssets(path: string, options?: BunStaticAssetsOptions) {
    this.logger.log(`Configuring static assets serving from path: ${path} with options: ${JSON.stringify(options)}`)
    this.staticAssetsOptions = { path, options }
  }

  // ============================================
  // Private Helper Methods
  // ============================================

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

  private async provideCorsHeaders(
    bunRequest: BunRequest,
  ): Promise<Headers> {
    const bunResponse = new BunResponse()
    await this.wsMiddlewareEngine.run({
      req: bunRequest,
      res: bunResponse,
      method: bunRequest.method,
      path: bunRequest.pathname,
      requestHandler: (req, res) => {
        // No need to do anything, just run the CORS middleware to set headers
        res.end()
      },
    })
    const response = await bunResponse.res()
    return response.headers
  }

  async upgrade(
    request: NativeRequest,
    bunRequest: BunRequest,
  ): Promise<boolean> {
    if (!this.useWs || !this.isWebSocketUpgradeRequest(request)) {
      return false
    }

    const headers = this.useWsCors ? await this.provideCorsHeaders(bunRequest) : undefined
    return bunRequest.server.upgrade(
      request, {
        headers,
        data: (await this.wsOptions.clientDataFactory?.(bunRequest)) ?? {},
      },
    )
  }

  private async setupStaticAssetsIfNeeded() {
    if (!this.staticAssetsOptions) return

    const { path, options } = this.staticAssetsOptions

    // Read all files from the specified directory
    const files = await readdir(path, { withFileTypes: true, recursive: true })
    // Register each file as a static route
    const flattenFiles = files.flat(Infinity)
    if (flattenFiles.length === 0) return

    const useStatic = options?.useStatic ?? false
    for (const file of flattenFiles) {
      if (!file.isFile()) continue

      const relativePath = file.parentPath.replace(path, '')
      const routePath = relativePath.startsWith('/') ? [relativePath, file.name].join('/') : `/${file.name}`
      if (useStatic) {
        const bunFile = Bun.file(join(file.parentPath, file.name))
        this.routes[routePath] = {
          GET: new Response(await bunFile.bytes(), {
            headers: {
              'Content-Type': bunFile.type,
            },
          }),
        }
      }
      else {
        this.delegateRouteHandler('GET', routePath, async (req, res) => {
          const bunFile = Bun.file(join(file.parentPath, file.name))
          // Because we wrap Bun routes handler in middleware, we need to handle 404 ourselves
          if (!await bunFile.exists()) {
            this.notFoundHandler(req, res)
            return
          }

          const ifModifiedSince = req.headers.get('if-modified-since')
          if (ifModifiedSince) {
            const lastModified = bunFile.lastModified
            // Compare dates
            if (new Date(ifModifiedSince).getTime() >= lastModified) {
              res.setStatus(304)
              res.end()
              return
            }
          }

          const range = req.headers.get('range')
          if (range) {
            const fileSize = bunFile.size
            const match = /bytes=(\d*)-(\d*)/.exec(range)
            if (match) {
              const start = parseInt(match[1], 10) || 0
              const end = parseInt(match[2], 10) || (fileSize - 1)
              if (start >= 0 && end < fileSize && start <= end) {
                res.setStatus(206)
                res.setHeader('Content-Range', `bytes ${start.toString()}-${(end).toString()}/${fileSize.toString()}`)
                res.end(bunFile.slice(start, end + 1))
                return
              }
              else {
                res.setStatus(416) // Range Not Satisfiable
                res.setHeader('Content-Range', `bytes */${fileSize.toString()}`)
                res.end()
                return
              }
            }
          }

          res.end(bunFile)
        })
      }
    }
  }

  private setupWebSocketIfNeeded(
    wsHandlers: typeof this.wsHandlers,
    bunServeOptions: ServerOptions<BunWsClientData>,
  ): void {
    const useWs
      = (
        typeof bunServeOptions.withGraphQL === 'object'
        && !!bunServeOptions.withGraphQL.open
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        && !!bunServeOptions.withGraphQL.message
        && !!bunServeOptions.withGraphQL.close
      )
      || (!!wsHandlers.onOpen && !!wsHandlers.onMessage && !!wsHandlers.onClose)
    if (!useWs) return

    this.useWs = true

    // Cache server reference to avoid repeated lookups
    const getServer = () => this.getBunServer()
    const onMessage = wsHandlers.onMessage
    const onOpen = wsHandlers.onOpen
    const onClose = wsHandlers.onClose

    const {
      clientDataFactory,
      ...graphQLSubscriptionWsHandlers
    } = typeof bunServeOptions.withGraphQL === 'object' ? bunServeOptions.withGraphQL : {}
    if (clientDataFactory) {
      this.wsOptions.clientDataFactory = clientDataFactory
    }

    bunServeOptions.websocket = Object.keys(graphQLSubscriptionWsHandlers).length > 0
      ? {
          ...this.wsOptions,
          ...graphQLSubscriptionWsHandlers,
        } as WebSocketHandler<BunWsClientData>
      : {
          ...this.wsOptions,
          message: (ws, message) => {
            // Call client-specific handler first if exists
            ws.data.onMessageInternal?.(message)
            // Then call global handler (for NestJS framework)
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            onMessage?.(ws, message, getServer()!)
          },
          open: (ws) => {
            onOpen?.(ws)
          },
          close: (ws, code, reason) => {
            // Call client-specific handlers
            ws.data.onCloseInternal?.()
            ws.data.onDisconnect?.(ws)
            // Then call global handler (for NestJS framework)
            onClose?.(ws, code, reason)
          },
        }
    delete bunServeOptions.withGraphQL

    const useWsCors = typeof this.wsOptions.cors !== 'undefined'
    if (!useWsCors) return

    this.useWsCors = true
    const corsMiddleware = new BunCorsMiddleware({
      corsOptions:
        this.wsOptions.cors === true ? undefined : this.wsOptions.cors,
    })
    this.wsMiddlewareEngine.useGlobal(corsMiddleware.run.bind(corsMiddleware))
  }

  private createServer(
    port: string | number,
    hostname: string,
    bunServeOptions: ServerOptions,
    fetch: (request: NativeRequest, server: Server<unknown>) => Promise<Response>,
  ): Server<unknown> {
    return BunServerInstance.isNumericPort(port)
      ? Bun.serve<unknown>({
          ...bunServeOptions,
          hostname,
          port,
          routes: this.routes,
          fetch,
        })
      : Bun.serve<unknown>({
          ...BunServerInstance.omitKeys(bunServeOptions, 'idleTimeout', 'port', 'hostname'),
          unix: port,
          routes: this.routes,
          fetch,
        })
  }

  private delegateRouteHandler(
    method: Serve.HTTPMethod,
    path: string,
    handler: BunRequestHandler,
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
    handler: BunRequestHandler,
  ): BunRequestHandler {
    // Hot path: if versioning is not used, return the original handler
    if (!this.useVersioning) return handler
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
    requestHandler: BunRequestHandler,
  ): (request: NativeRequest, server: Server<unknown>) => Promise<Response> {
    return async (
      request: NativeRequest,
      server: Server<unknown>,
    ): Promise<Response> => {
      const bunRequest = new BunRequest(request, server)
      // Just in case we have controllers/routes registered, this will handle websocket upgrade requests, but only for root path
      if (path === '/' && (await this.upgrade(request, bunRequest))) {
        return undefined as unknown as Response
      }

      // const bunResponse = new BunResponse()
      const bunResponse = await this.middlewareEngine.run({
        req: bunRequest,
        res: new BunResponse(),
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
    handler: BunRequestHandler,
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
    handlers: BunRequestHandler[],
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
    handlers: BunRequestHandler[],
    notFoundHandler: BunRequestHandler,
  ): BunRequestHandler {
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
    }) as BunRequestHandler
  }

  private mapRequestMethodToString(requestMethod: RequestMethod): string {
    return REQUEST_METHOD_STRINGS[requestMethod] ?? 'ALL'
  }

  private parseRouteHandler(handler: BunRequestHandler): {
    path: string
    handler: BunRequestHandler
  }
  private parseRouteHandler(
    path: unknown,
    handler?: BunRequestHandler,
  ): { path: string, handler: BunRequestHandler }
  private parseRouteHandler(
    pathOrHandler: unknown,
    maybeHandler?: BunRequestHandler,
  ): { path: string, handler: BunRequestHandler } {
    const path = typeof pathOrHandler === 'string' ? pathOrHandler : '/'
    const handler
      = typeof pathOrHandler === 'function'
        ? (pathOrHandler as BunRequestHandler)
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        : maybeHandler!
    return { path, handler }
  }
}
