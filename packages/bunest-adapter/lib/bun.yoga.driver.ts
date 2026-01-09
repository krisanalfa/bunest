import { type DocumentNode, type ExecutionArgs, GraphQLError } from 'graphql'
import { GRAPHQL_TRANSPORT_WS_PROTOCOL, ServerOptions, makeServer } from 'graphql-ws'
import { HttpStatus, Injectable, Logger } from '@nestjs/common'
import { Server, ServerWebSocket } from 'bun'
import { YogaServerOptions, createYoga, maskError as defaultMaskError } from 'graphql-yoga'

import { AbstractGraphQLDriver, GqlModuleOptions } from '@nestjs/graphql'

import { BunServerInstance } from './bun.server-instance.js'
import { WsOptions } from './bun.internal.types.js'

/**
 * Predefined mapping of HTTP status codes to GraphQL error codes.
 * Similar to Apollo's implementation for consistency.
 */
const yogaPredefinedExceptions: Partial<Record<HttpStatus, string>> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'BAD_USER_INPUT',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
}

class LoggerWithInfo extends Logger {
  info(message: unknown, ...args: unknown[]) {
    this.log(message, ...args)
  }
}

export interface BunYogaDriverConfig<TContext = object> extends Pick<GqlModuleOptions<BunYogaDriver>, 'schema' | 'path' | 'driver'> {
  /**
   * Custom health check endpoint path.
   *
   * @see https://the-guild.dev/graphql/yoga-server/docs/features/health-check
   */
  healthCheckEndpoint?: YogaServerOptions<Server<unknown>, TContext>['healthCheckEndpoint']

  /**
   * Logging configuration.
   *
   * @see https://the-guild.dev/graphql/yoga-server/docs/features/logging-and-debugging
   */
  logging?: YogaServerOptions<Server<unknown>, TContext>['logging']

  /**
   * Batching configuration options.
   *
   * @see https://the-guild.dev/graphql/yoga-server/docs/features/request-batching
   */
  batching?: YogaServerOptions<Server<unknown>, TContext>['batching']

  /**
   * CORS configuration options.
   *
   * @see https://the-guild.dev/graphql/yoga-server/docs/features/cors
   */
  cors?: YogaServerOptions<Server<unknown>, TContext>['cors']

  /**
   * Additional plugins to be used by the Yoga server.
   *
   * @see https://the-guild.dev/graphql/yoga-server/docs/features/envelop-plugins
   */
  plugins?: YogaServerOptions<Server<unknown>, TContext>['plugins']

  /**
   * Context to be provided to GraphQL resolvers.
   *
   * @see https://the-guild.dev/graphql/yoga-server/docs/features/context
   */
  context?: YogaServerOptions<Server<unknown>, TContext>['context']

  /**
   * Has to be true to generate schema and works with subscriptions.
   */
  autoSchemaFile: true

  /**
   * Whether to enable subscriptions support and which protocol to use.
   */
  subscriptions?: {
    /**
     * At the moment, only 'graphql-ws' protocol is supported.
     */
    'graphql-ws'?: boolean
      | Pick<ServerOptions,
      | 'connectionInitWaitTimeout'
      | 'onConnect'
      | 'onDisconnect'
      | 'onClose'
      >
  }

  /**
   * Whether to enable GraphiQL interface.
   */
  graphiql?: YogaServerOptions<Server<unknown>, TContext>['graphiql']

  /**
   * If enabled, will automatically transform HTTP exceptions to GraphQL errors
   * with appropriate error codes. Disables Yoga's default error masking behavior.
   * @default false
   */
  autoTransformHttpErrors?: boolean

  /**
   * Pass custom data for each WebSocket connection.
   */
  clientDataFactory?: WsOptions['clientDataFactory']
}

interface HttpExceptionRef {
  response?: { statusCode?: number, message?: string }
  status?: number
  message?: string
}

interface Client {
  handleMessage: (data: string) => Promise<void>
  closed: (code: number, reason: string) => Promise<void>
}

@Injectable()
export class BunYogaDriver extends AbstractGraphQLDriver<BunYogaDriverConfig> {
  private readonly clients = new WeakMap<ServerWebSocket<unknown>, Client>()
  private yoga!: ReturnType<typeof createYoga<Server<unknown>>>

  /**
   * Creates a custom maskError function that transforms HTTP exceptions to GraphQL errors.
   * This mimics Apollo's autoTransformHttpErrors behavior.
   */
  private createMaskError() {
    return (
      error: unknown,
      message: string,
    ): Error | GraphQLError => {
      // Check if this is an HTTP exception (NestJS HttpException)
      const exceptionRef = error as HttpExceptionRef

      const isHttpException = exceptionRef.response?.statusCode && exceptionRef.status

      if (isHttpException) {
        const httpStatus = exceptionRef.status as HttpStatus
        const errorMessage = exceptionRef.response?.message ?? exceptionRef.message ?? message

        // Map HTTP status to GraphQL error code
        const code = yogaPredefinedExceptions[httpStatus] ?? 'INTERNAL_SERVER_ERROR'

        return new GraphQLError(errorMessage, {
          extensions: {
            code,
            ...(!(httpStatus in yogaPredefinedExceptions) ? { status: httpStatus } : {}),
            ...(exceptionRef.response ? { originalError: exceptionRef.response } : {}),
          },
        })
      }

      // Check if this is already a GraphQLError (expose it as-is)
      if (error instanceof GraphQLError) {
        return error
      }

      // For all other errors, return the masked error message
      return new GraphQLError(message)
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async start(config: BunYogaDriverConfig) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const schema = config.schema!
    const yoga = createYoga<Server<unknown>>({
      cors: config.cors,
      context: async initialContext => ({
        ...(
          typeof config.context === 'function'
            ? (await config.context(initialContext) as object)
            : config.context ?? {}
        ),
        // NestJS expects request to be available in context
        req: initialContext.request,
      }),
      schema,
      graphqlEndpoint: config.path,
      graphiql: config.graphiql,
      maskedErrors: config.autoTransformHttpErrors ?? false
        ? {
            maskError: (error: unknown, message: string, isDev?: boolean): Error => {
            // First, try to transform HTTP errors
              const transformedError = this.createMaskError()(error, message)

              // If not transformed (still generic), use default masking
              if (
                transformedError instanceof GraphQLError
                && transformedError.message === message
                && !transformedError.extensions.code
              ) {
                return defaultMaskError(error, message, isDev ?? false)
              }

              return transformedError
            },
          }
        : false,
      healthCheckEndpoint: config.healthCheckEndpoint,
      // disable logging by default
      // however, if `true` use nest logger
      logging:
        config.logging == null
          ? false
          // eslint-disable-next-line sonarjs/no-nested-conditional
          : config.logging
            ? new LoggerWithInfo('BunYogaDriver')
            : config.logging,
      batching: config.batching,
      plugins: config.plugins,
    })

    this.configureRoutes(config, yoga)
    this.configureSubscriptions(config, yoga)

    this.yoga = yoga
  }

  private configureRoutes(config: BunYogaDriverConfig, yoga: ReturnType<typeof createYoga<Server<unknown>>>) {
    const server = this.httpAdapterHost.httpAdapter.getHttpServer() as BunServerInstance
    // Skip body parser for GraphQL endpoint
    server.skipParserMiddleware(yoga.graphqlEndpoint)
    // Main GraphQL endpoint
    server.post(yoga.graphqlEndpoint, async (req, res) => {
      const body = await yoga.handleRequest(req.original(), req.server)
      res.end(body)
    })
    // Handle upgrade for subscriptions as well as graphiql if enabled
    server.get(yoga.graphqlEndpoint, async (req, res) => {
      if (await server.upgrade(req.original(), req)) {
        return
      }
      const body = await yoga.handleRequest(req.original(), req.server)
      res.end(body)
    })
    // Handle OPTIONS requests for CORS preflight
    server.options(yoga.graphqlEndpoint, async (req, res) => {
      const body = await yoga.handleRequest(req.original(), req.server)
      res.end(body)
    })
    // Health check endpoint
    server.get(config.healthCheckEndpoint ?? '/health', async (req, res) => {
      const body = await yoga.handleRequest(req.original(), req.server)
      res.end(body)
    })
  }

  private configureSubscriptions(config: BunYogaDriverConfig, yoga: ReturnType<typeof createYoga<Server<unknown>>>) {
    if (!config.subscriptions?.['graphql-ws']) {
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const schema = config.schema!
    const server = this.httpAdapterHost.httpAdapter.getHttpServer() as BunServerInstance
    const wsServer = makeServer({
      schema,
      onSubscribe: async (ctx, id, params) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const { schema: yogaSchema, execute, subscribe, contextFactory, parse, validate } = yoga.getEnveloped({
          ...ctx,
          req: undefined,
          socket: (ctx.extra as { socket: ServerWebSocket }).socket,
          params,
        })

        const args: ExecutionArgs = {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          schema: yogaSchema,
          operationName: params.operationName,
          document: parse(params.query) as DocumentNode,
          variableValues: params.variables,
          contextValue: await contextFactory({ execute, subscribe }),
        }

        const errors = validate(args.schema, args.document) as unknown as GraphQLError[]
        if (errors.length) return errors
        return args
      },
    })

    server.setWsHandlers({
      clientDataFactory: config.clientDataFactory,
      open: (ws) => {
        const client: Client = {
          handleMessage: () => {
            throw new Error('Message received before handler was registered')
          },
          closed: () => {
            throw new Error('Closed before handler was registered')
          },
        }
        client.closed = wsServer.opened(
          {
            protocol: GRAPHQL_TRANSPORT_WS_PROTOCOL,
            send: (message) => {
              if (this.clients.has(ws)) {
                ws.sendText(message)
              }
            },
            close: (code, reason) => {
              if (this.clients.has(ws)) {
                ws.close(code, reason)
              }
            },
            onMessage: (cb) => {
              client.handleMessage = cb
            },
          },
          { socket: ws },
        )
        this.clients.set(ws, client)
      },
      message: async (ws, message) => {
        const client = this.clients.get(ws)
        if (!client) throw new Error('Message received for a missing client')
        await client.handleMessage(String(message))
        return undefined
      },
      close: async (ws, code, reason) => {
        const client = this.clients.get(ws)
        if (!client) throw new Error('Closing a missing client')
        await client.closed(code, reason)
      },
    })
  }

  async stop(): Promise<void> {
    // later, implement graceful shutdown of subscriptions (closing all connections)
    await this.yoga.dispose()
  }
}
