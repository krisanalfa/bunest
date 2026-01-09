/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { ApolloClient, ApolloLink, CombinedGraphQLErrors, HttpLink, InMemoryCache, gql } from '@apollo/client'
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo'
import { Args, Field, GraphQLModule, GraphQLSchemaHost, ID, MiddlewareContext, Mutation, ObjectType, Query, Resolver, Subscription } from '@nestjs/graphql'
import { Context, createClient } from 'graphql-ws'
import { Inject, Module, NotFoundException } from '@nestjs/common'
import { ServerWebSocket, sleep } from 'bun'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { GraphQLWsLink } from '@apollo/client/link/subscriptions'
import { OperationTypeNode } from 'graphql'
import { PubSub } from 'graphql-subscriptions'
import { Test } from '@nestjs/testing'
import { WebSocket } from 'ws'
import { makeHandler } from 'graphql-ws/use/bun'

import { NestBunApplication, ServerOptions } from '../../bun.internal.types.js'
import { BunAdapter } from '../../bun.adapter.js'
import { BunRequest } from '../../bun.request.js'

@ObjectType()
class HumanModel {
  @Field(() => ID)
  id!: string

  @Field(() => String)
  name!: string

  @Field(() => String, {
    middleware: [
      async (ctx: MiddlewareContext<unknown, {
        req: BunRequest
      }>, next) => {
        const value = (await next()) as string
        return value.toUpperCase()
      },
    ],
  })
  sex!: string
}

const DB: HumanModel[] = [
  { id: '1', name: 'John Doe', sex: 'male' },
  { id: '2', name: 'Jane Doe', sex: 'female' },
]

// Create a shared PubSub token
const PUB_SUB = 'PUB_SUB'

@Resolver(HumanModel)
class HumanResolver {
  constructor(@Inject(PUB_SUB) private readonly pubSub: PubSub) {}

  @Query(() => HumanModel, { name: 'human' })
  getHuman(
    @Args('id', { type: () => ID }) id: string,
  ): HumanModel {
    const human = DB.find(h => h.id === id)
    if (!human) {
      throw new NotFoundException()
    }
    return human
  }

  @Query(() => [HumanModel], { name: 'humans' })
  getHumans(): HumanModel[] {
    return DB
  }

  @Mutation(() => HumanModel, { name: 'createHuman' })
  async createHuman(
    @Args('name', { type: () => String }) name: string,
    @Args('sex', { type: () => String }) sex: string,
  ): Promise<HumanModel> {
    const newHuman = { id: (DB.length + 1).toString(), name, sex }
    DB.push(newHuman)
    await this.pubSub.publish('humanCreated', { humanCreated: newHuman })
    return newHuman
  }

  @Subscription(() => HumanModel, { name: 'humanCreated' })
  humanCreated() {
    return this.pubSub.asyncIterableIterator('humanCreated')
  }
}

@Module({
  providers: [HumanResolver, { provide: PUB_SUB, useValue: new PubSub() }],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class HumanModule {}

@Module({
  imports: [
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      useFactory: () => {
        return {
          autoSchemaFile: true,
          autoTransformHttpErrors: true,
          subscriptions: {
            'graphql-ws': true,
          },
        }
      },
    }),
    HumanModule,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class AppModule {}

describe('BunAdapter Apollo', () => {
  let app: NestBunApplication
  let client: ApolloClient
  let connectedClientUid: string | null = null

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleRef.createNestApplication<NestBunApplication>(
      new BunAdapter({
        withGraphQL: {
          ...(makeHandler({
            schema: () => {
              const schemaHost = app.get(GraphQLSchemaHost)
              const schema = schemaHost.schema
              return schema
            },
            onConnect: ({ extra: { socket }}: Context<Record<string, unknown>, { socket: ServerWebSocket<{ uid: string }> }>) => {
              connectedClientUid = socket.data.uid
            },
          })),
          clientDataFactory: (req) => {
            return { uid: req.headers.get('x-user-id') ?? 'anonymous' }
          },
        } as ServerOptions<{ uid: string }>['withGraphQL'],
      }),
      {
        cors: true,
      },
    )
    await app.listen(0)
    const server = app.getHttpServer().getBunServer()
    const url = server!.url.toString()

    const httpLink = new HttpLink({
      uri: `${url}graphql`,
      // @ts-expect-error Bun's fetch doesn't support preconnect
      fetch: async (url, options) => {
        const response = await fetch(url, {
          ...options,
        })
        // Test CORS headers
        expect(response.headers.get('access-control-allow-origin')).toBe('*')
        return response
      },
    })
    class CustomWebSocket extends WebSocket {
      constructor(url: string, protocols?: string | string[]) {
        super(url, protocols, {
          headers: {
            'x-user-id': 'test-user',
          },
        })
      }
    }
    const wsLink = new GraphQLWsLink(
      createClient({
        url: `${url.replace('http', 'ws')}graphql`,
        webSocketImpl: CustomWebSocket,
      }),
    )
    const splitLink = ApolloLink.split(
      ({ operationType }) => operationType === OperationTypeNode.SUBSCRIPTION,
      wsLink,
      httpLink,
    )

    client = new ApolloClient({
      link: splitLink,
      cache: new InMemoryCache(),
    })
  })

  it('should fetch a human', async () => {
    const result = await client.query<{ human: HumanModel }>({
      query: gql`
        query GetHuman($id: ID!) {
          human(id: $id) {
            id
            name
            sex
          }
        }
      `,
      variables: {
        id: '1',
      },
    })

    // Assert the result
    const human = result.data?.human
    expect(human).toBeDefined()
    expect(human!.id).toBe('1')
    expect(human!.name).toBe('John Doe')
    // sex will be uppercased by middleware
    expect(human!.sex).toBe('MALE')
  })

  it('should fetch all humans', async () => {
    const result = await client.query<{ humans: HumanModel[] }>({
      query: gql`
        query GetHumans {
          humans {
            id
            name
          }
        }
      `,
    })

    // Assert the result
    const humans = result.data?.humans
    expect(humans).toBeDefined()
    expect(humans!.length).toBe(2)
  })

  it('should create a new human', async () => {
    const result = await client.mutate<{ createHuman: HumanModel }>({
      mutation: gql`
        mutation CreateHuman($name: String!, $sex: String!) {
          createHuman(name: $name, sex: $sex) {
            id
            name
          }
        }
      `,
      variables: {
        name: 'New Human',
        sex: 'other',
      },
    })

    // Assert the result
    const newHuman = result.data?.createHuman
    expect(newHuman).toBeDefined()
    expect(newHuman!.id).toBeDefined()
    expect(newHuman!.name).toBe('New Human')
  })

  it('should subscribe to humanCreated', async () => {
    const subscription = client.subscribe<{ humanCreated: HumanModel }>({
      query: gql`
        subscription OnHumanCreated {
          humanCreated {
            id
            name
          }
        }
      `,
    })

    const receivedData = new Promise<HumanModel>((resolve) => {
      subscription.subscribe((result) => {
        if (result.data?.humanCreated) {
          resolve(result.data.humanCreated)
        }
      })
    })

    // Wait until the subscription is ready
    await sleep(10)

    // Trigger the subscription by creating a new human
    await client.mutate<{ createHuman: HumanModel }>({
      mutation: gql`
        mutation CreateHuman($name: String!, $sex: String!) {
          createHuman(name: $name, sex: $sex) {
            id
            name
          }
        }
      `,
      variables: {
        name: 'Subscribed Human',
        sex: 'other',
      },
    })

    // Wait for the subscription to receive the data
    const human = await receivedData
    expect(human).toBeDefined()
    expect(human.name).toBe('Subscribed Human')
    expect(connectedClientUid).toBe('test-user')
  })

  it('should return not found for non-existing human', async () => {
    try {
      await client.query<{ human: HumanModel }>({
        query: gql`
          query GetHuman($id: ID!) {
            human(id: $id) {
              id
              name
            }
          }
        `,
        variables: {
          id: '999',
        },
      })
    }
    catch (error) {
      expect((error as CombinedGraphQLErrors).message).toContain('Not Found')
    }
  })

  afterEach(() => {
    connectedClientUid = null
  })

  afterAll(async () => {
    await client.clearStore()
    client.stop()
    await Promise.race([
      app.close(),
      new Promise(resolve => setTimeout(resolve, 500)),
    ])
  })
})
