import {
  CorsOptionsDelegate,
  CorsOptions as NestCorsOptions,
} from '@nestjs/common/interfaces/external/cors-options.interface.js'
import { IncomingMessage, ServerResponse } from 'node:http'
import cors, { CorsOptions } from 'cors'

import { BunRequest } from './bun.request.js'
import { BunResponse } from './bun.response.js'

type NextFunction = ((err?: Error) => void) | undefined

export class BunCorsMiddleware {
  private readonly options?: NestCorsOptions | CorsOptionsDelegate<BunRequest>
  private readonly prefix?: string

  constructor(options?: {
    corsOptions?: NestCorsOptions | CorsOptionsDelegate<BunRequest>
    prefix?: string
  }) {
    this.options = options?.corsOptions
    this.prefix = options?.prefix
  }

  async run(
    req: BunRequest,
    res: BunResponse,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    next: NextFunction | Function,
  ): Promise<void> {
    const nextFn = next as NextFunction

    if (this.prefix && !req.pathname.startsWith(this.prefix)) {
      return nextFn?.()
    }

    const corsOptions = await this.resolveCorsOptions(req)
    const { nodeReq, nodeRes, isEnded } = this.createNodeAdapters(req, res)

    cors(corsOptions)(nodeReq, nodeRes, (err?: Error) => {
      if (err) return nextFn?.(err)
      if (!isEnded()) nextFn?.()
    })
  }

  private async resolveCorsOptions(
    req: BunRequest,
  ): Promise<CorsOptions | undefined> {
    const options = this.options
    if (typeof options === 'function') {
      return new Promise((resolve, reject) => {
        options(req, (err: Error | null, opts: NestCorsOptions | undefined) => {
          if (err) reject(err)
          else resolve(opts as CorsOptions)
        })
      })
    }
    if (!options) return undefined
    return {
      origin: options.origin as CorsOptions['origin'],
      methods: options.methods,
      allowedHeaders: options.allowedHeaders,
      exposedHeaders: options.exposedHeaders,
      credentials: options.credentials,
      maxAge: options.maxAge,
      preflightContinue: options.preflightContinue,
      optionsSuccessStatus: options.optionsSuccessStatus,
    }
  }

  private createNodeAdapters(req: BunRequest, res: BunResponse) {
    const nodeReq = {
      method: req.method,
      headers: req.headers,
      url: req.pathname,
    } as unknown as IncomingMessage

    const nodeRes = {
      get statusCode() { return res.getStatus() },
      set statusCode(code: number) { res.setStatus(code) },
      setHeader: (key: string, value: string) => { res.setHeader(key, value) },
      end: (data?: unknown) => { res.end(data) },
      getHeader: (name: string) => res.getHeader(name),
      removeHeader: (name: string) => { res.removeHeader(name) },
    } as unknown as ServerResponse

    return { nodeReq, nodeRes, isEnded: () => res.isEnded() }
  }
}
