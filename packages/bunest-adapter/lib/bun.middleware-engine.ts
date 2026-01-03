import { ErrorHandler, RequestHandler } from '@nestjs/common/interfaces/index.js'
import { ErrorLike } from 'bun'

import { BunRequest } from './bun.request.js'
import { BunResponse } from './bun.response.js'

type MiddlewareHandler = RequestHandler<BunRequest, BunResponse>
interface MiddlewareRunOptions {
  req: BunRequest
  res: BunResponse
  method: string
  path: string
  requestHandler: MiddlewareHandler
}

// Shared empty array to avoid allocations
const EMPTY_HANDLERS: readonly MiddlewareHandler[] = new Array<MiddlewareHandler>(0)

// Reusable noop function for error handler
const noop = (): void => { /* noop */ }

export class BunMiddlewareEngine {
  private readonly globalMiddlewares: MiddlewareHandler[] = []
  private readonly routeMiddleware = new Map<string, MiddlewareHandler[]>()
  // Group route middleware by method for faster prefix matching
  private readonly routeMiddlewareByMethod = new Map<string, Map<string, MiddlewareHandler[]>>()
  private readonly wildcardMiddleware = new Map<string, MiddlewareHandler[]>()
  private readonly middlewareCache = new Map<string, MiddlewareHandler[]>()
  private errorHandler: ErrorHandler<BunRequest, BunResponse> | null = null
  private notFoundHandler: MiddlewareHandler | null = null

  useGlobal(middleware: MiddlewareHandler): void {
    this.globalMiddlewares.push(middleware)
  }

  useRoute(method: string, path: string, middleware: MiddlewareHandler): void {
    const key = `${method}:${path}`;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    (this.routeMiddleware.get(key) ?? (this.routeMiddleware.set(key, []).get(key)!)).push(middleware);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    (this.routeMiddlewareByMethod.get(method) ?? this.routeMiddlewareByMethod.set(method, new Map()).get(method)!)
      .set(path, ((this.routeMiddlewareByMethod.get(method)?.get(path)) ?? []))
      .get(path)!
      .push(middleware)
  }

  useWildcard(method: string, middleware: MiddlewareHandler): void {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    (this.wildcardMiddleware.get(method) ?? this.wildcardMiddleware.set(method, []).get(method)!).push(middleware)
  }

  useErrorHandler(handler: ErrorHandler<BunRequest, BunResponse>): void {
    this.errorHandler = handler
  }

  useNotFoundHandler(handler: MiddlewareHandler): void {
    this.notFoundHandler = handler
  }

  findRouteHandler(method: string, path: string): MiddlewareHandler | null {
    // Try exact match first (method-specific, then ALL)
    const exactHandler = this.findExactRouteHandler(method, path)
    if (exactHandler) return exactHandler

    // Try prefix match
    return this.findPrefixRouteHandler(method, path)
  }

  private findExactRouteHandler(method: string, path: string): MiddlewareHandler | null {
    const exactKey = `${method}:${path}`
    const exactMiddleware = this.routeMiddleware.get(exactKey)
    if (exactMiddleware && exactMiddleware.length > 0) {
      return exactMiddleware[exactMiddleware.length - 1]
    }

    const allExactKey = `ALL:${path}`
    const allExactMiddleware = this.routeMiddleware.get(allExactKey)
    if (allExactMiddleware && allExactMiddleware.length > 0) {
      return allExactMiddleware[allExactMiddleware.length - 1]
    }

    return null
  }

  private findPrefixRouteHandler(method: string, path: string): MiddlewareHandler | null {
    const methodMap = this.routeMiddlewareByMethod.get(method)
    const allMethodMap = this.routeMiddlewareByMethod.get('ALL')

    if (!methodMap && !allMethodMap) return null

    const mapsToCheck: Map<string, MiddlewareHandler[]>[] = []
    if (methodMap) mapsToCheck.push(methodMap)
    if (allMethodMap) mapsToCheck.push(allMethodMap)

    return this.findBestMatchInMaps(mapsToCheck, path)
  }

  private findBestMatchInMaps(
    maps: Map<string, MiddlewareHandler[]>[],
    path: string,
  ): MiddlewareHandler | null {
    let bestMatch: MiddlewareHandler | null = null
    let bestMatchLength = 0
    const pathLen = path.length

    for (const map of maps) {
      for (const [keyPath, middleware] of map) {
        if (middleware.length === 0 || keyPath.length <= bestMatchLength) continue

        if (this.isPrefixMatch(path, pathLen, keyPath)) {
          bestMatch = middleware[middleware.length - 1]
          bestMatchLength = keyPath.length
        }
      }
    }

    return bestMatch
  }

  private isPrefixMatch(path: string, pathLen: number, keyPath: string): boolean {
    const keyPathLen = keyPath.length
    return path === keyPath || (pathLen > keyPathLen && path.charCodeAt(keyPathLen) === 47 && path.startsWith(keyPath))
  }

  async run(options: MiddlewareRunOptions): Promise<BunResponse> {
    try {
      const middlewares = this.getMiddlewareChain(options.method, options.path)
      await this.executeChain(middlewares, options.requestHandler, options.req, options.res)
      return options.res
    }
    catch (error) {
      return this.handleError(error, options.req, options.res)
    }
  }

  private getMiddlewareChain(method: string, path: string): MiddlewareHandler[] {
    const cacheKey = `${method}:${path}`
    let cached = this.middlewareCache.get(cacheKey)
    if (cached !== undefined) return cached

    cached = this.buildMiddlewareChain(method, path, cacheKey)
    this.middlewareCache.set(cacheKey, cached)
    return cached
  }

  private buildMiddlewareChain(
    method: string,
    path: string,
    cacheKey: string,
  ): MiddlewareHandler[] {
    // Minimize array operations and allocations
    const global = this.globalMiddlewares
    const globalLen = global.length
    const wildcardAll = this.wildcardMiddleware.get('ALL')
    const wildcardMethod = this.wildcardMiddleware.get(method)
    const routeMiddleware = this.findRouteMiddleware(method, path, cacheKey)

    const wildcardAllLen = wildcardAll?.length ?? 0
    const wildcardMethodLen = wildcardMethod?.length ?? 0
    const routeLen = routeMiddleware.length

    const totalLen = globalLen + wildcardAllLen + wildcardMethodLen + routeLen
    if (totalLen === 0) return EMPTY_HANDLERS as MiddlewareHandler[]

    // Avoid iterator overhead from for...of loops
    const chain = new Array<MiddlewareHandler>(totalLen)
    let idx = 0

    // Global middlewares
    for (let i = 0; i < globalLen; i++) chain[idx++] = global[i]
    // Wildcard middlewares
    if (wildcardAll) for (let i = 0; i < wildcardAllLen; i++) chain[idx++] = wildcardAll[i]
    // Method-specific wildcard middlewares
    if (wildcardMethod) for (let i = 0; i < wildcardMethodLen; i++) chain[idx++] = wildcardMethod[i]
    // Route-specific middlewares
    for (let i = 0; i < routeLen; i++) chain[idx++] = routeMiddleware[i]

    return chain
  }

  private findRouteMiddleware(
    method: string,
    path: string,
    cacheKey: string,
  ): readonly MiddlewareHandler[] {
    const exactMiddleware = this.routeMiddleware.get(cacheKey)
    if (exactMiddleware !== undefined) return exactMiddleware
    return this.findBestPrefixMatch(method, path)
  }

  private findBestPrefixMatch(
    method: string,
    path: string,
  ): readonly MiddlewareHandler[] {
    const methodMap = this.routeMiddlewareByMethod.get(method)
    if (!methodMap) return EMPTY_HANDLERS

    let bestMatch: MiddlewareHandler[] | null = null
    let bestMatchLength = 0
    const pathLen = path.length

    for (const [keyPath, middleware] of methodMap) {
      const keyPathLen = keyPath.length
      if (keyPathLen <= bestMatchLength || middleware.length === 0) continue

      // Fast path check: exact match or prefix match with /
      if (path === keyPath || (pathLen > keyPathLen && path.charCodeAt(keyPathLen) === 47 /* '/' */ && path.startsWith(keyPath))) {
        bestMatch = middleware
        bestMatchLength = keyPathLen
      }
    }

    return bestMatch ?? EMPTY_HANDLERS
  }

  private async executeChain(
    chain: MiddlewareHandler[],
    requestHandler: MiddlewareHandler,
    req: BunRequest,
    res: BunResponse,
  ): Promise<void> {
    const chainLength = chain.length
    let index = 0

    const next = async (err?: ErrorLike): Promise<void> => {
      if (err) throw err

      // Process middleware chain
      if (index < chainLength) {
        const handler = chain[index++]
        const result = handler(req, res, next) as unknown
        if (result instanceof Promise) await result
        return
      }

      // Process request handler at the end only if response hasn't been ended
      if (index === chainLength) {
        index++
        // Skip handler if response already ended by middleware
        if (!res.isEnded()) {
          const result = requestHandler(req, res, next) as unknown
          if (result instanceof Promise) await result
        }
        return
      }

      // If next is called after the handler, call not found handler
      if (index > chainLength && !res.isEnded()) {
        const result = this.notFoundHandler?.(req, res, noop) as unknown
        if (result instanceof Promise) await result
      }
    }

    await next()
  }

  private async handleError(
    error: unknown,
    req: BunRequest,
    res: BunResponse,
  ): Promise<BunResponse> {
    if (this.errorHandler !== null) {
      const result = this.errorHandler(error, req, res, noop) as unknown
      if (result instanceof Promise) await result
      return res
    }
    throw error
  }
}
