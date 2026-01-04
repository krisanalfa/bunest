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
import { Server, randomUUIDv7 } from 'bun'
import { AbstractHttpAdapter } from '@nestjs/core'
import { VersionValue } from '@nestjs/common/interfaces/version-options.interface.js'

import { BunWsClientData, ServerOptions } from './bun.internal.types.js'
import { BunPreflightHttpServer } from './bun.preflight-http-server.js'
import { BunRequest } from './bun.request.js'
import { BunResponse } from './bun.response.js'
import { BunServerInstance } from './bun.server-instance.js'
import { BunVersionFilterMiddleware } from './bun.version-filter.middleware.js'

export class BunAdapter extends AbstractHttpAdapter<
  Server<unknown>,
  BunRequest,
  BunResponse
> {
  private readonly logger: Logger = new Logger('BunAdapter', { timestamp: true })
  declare protected instance: BunServerInstance

  constructor(protected bunServeOptions: ServerOptions<BunWsClientData> = {
    development: false,
    id: randomUUIDv7(),
  }) {
    super(new BunServerInstance(bunServeOptions))
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
    await this.instance.close()
  }

  initHttpServer(options: NestApplicationOptions) {
    this.configureTls(options)
    const preflightServer = new BunPreflightHttpServer(this.instance)
    // Hack to set the http server instance before listen is called
    this.setHttpServer(preflightServer as unknown as Server<unknown>)
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
    this.instance.getMiddlewareEngine().useErrorHandler(handler)
  }

  setNotFoundHandler(
    handler: RequestHandler<BunRequest, BunResponse>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    prefix?: string,
  ) {
    this.instance.setNotFoundHandler(handler)
    this.instance.getMiddlewareEngine().useNotFoundHandler(handler)
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
    this.instance.registerParserMiddleware(prefix, rawBody)
  }

  enableCors(
    options?: CorsOptions | CorsOptionsDelegate<BunRequest>,
    prefix?: string,
  ): void {
    this.instance.enableCors(options, prefix)
  }

  createMiddlewareFactory(
    requestMethod: RequestMethod,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  ): (path: string, callback: Function) => void {
    return this.instance.createMiddlewareFactory(requestMethod)
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
    this.instance.setUseVersioning(true)
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
    // Delegate to server instance, then update httpServer reference
    this.setHttpServer(
      this.instance.listen(port, hostnameOrCallback as string, maybeCallback),
    )
  }

  private configureTls(options: NestApplicationOptions) {
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
}
