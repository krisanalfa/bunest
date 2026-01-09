/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { ApolloClient, ApolloLink, CombinedGraphQLErrors, HttpLink, InMemoryCache, gql } from '@apollo/client'
import { Args, Field, GraphQLModule, ID, MiddlewareContext, Mutation, ObjectType, Query, Resolver, Subscription } from '@nestjs/graphql'
import { Injectable, Module, NotFoundException } from '@nestjs/common'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { GraphQLWsLink } from '@apollo/client/link/subscriptions'
import { OperationTypeNode } from 'graphql'
import { Test } from '@nestjs/testing'
import { WebSocket } from 'ws'
import { createClient } from 'graphql-ws'
import { createPubSub } from 'graphql-yoga'
import { sleep } from 'bun'

import { BunYogaDriver, BunYogaDriverConfig } from '../../bun.yoga.driver.js'
import { BunAdapter } from '../../bun.adapter.js'
import { BunRequest } from '../../bun.request.js'
import { NestBunApplication } from '../../bun.internal.types.js'

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

@Injectable()
class PubSubService {
  pubSub = createPubSub<{
    humanCreated: [{ humanCreated: HumanModel }]
  }>()
}

@Resolver(HumanModel)
class HumanResolver {
  constructor(private readonly pubSubService: PubSubService) {}
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
  createHuman(
    @Args('name', { type: () => String }) name: string,
    @Args('sex', { type: () => String }) sex: string,
  ): HumanModel {
    const humanCreated = { id: (DB.length + 1).toString(), name, sex }
    DB.push(humanCreated)
    this.pubSubService.pubSub.publish('humanCreated', { humanCreated })
    return humanCreated
  }

  @Subscription(() => HumanModel, { name: 'humanCreated' })
  humanCreated() {
    return this.pubSubService.pubSub.subscribe('humanCreated')
  }
}

@Module({
  providers: [PubSubService, HumanResolver],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class HumanModule {}

describe('BunAdapter GraphQL Yoga', () => {
  let app: NestBunApplication
  let client: ApolloClient
  let url: string
  let connectedClientUid: string | null = null
  let middlewareCalled = false

  @Module({
    imports: [
      GraphQLModule.forRoot<BunYogaDriverConfig>({
        driver: BunYogaDriver,
        autoSchemaFile: true,
        autoTransformHttpErrors: true,
        subscriptions: {
          'graphql-ws': true,
        },
        clientDataFactory: (req) => {
          connectedClientUid = req.headers.get('x-user-id') ?? null
          return {}
        },
      }),
      HumanModule,
    ],
  })
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  class AppModule {}

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleRef.createNestApplication<NestBunApplication>(
      new BunAdapter(),
    )
    await app.listen(0)
    const server = app.getHttpServer().getBunServer()
    url = server!.url.toString()

    app.getHttpServer().use((req, res, next) => {
      middlewareCalled = true
      next?.()
    })

    const httpLink = new HttpLink({
      uri: `${url}graphql`,
      // @ts-expect-error Bun's fetch doesn't support preconnect
      fetch: async (url, options) => fetch(url, {
        ...options,
      }),
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

  beforeEach(() => {
    middlewareCalled = false
    connectedClientUid = null
  })

  it('should return cors headers for preflight request', async () => {
    const response = await fetch(`${url}graphql`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'X-User-Id, Content-Type',
      },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://example.com')
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST')
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('X-User-Id')
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type')
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
    expect(middlewareCalled).toBe(true)
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

    const receivedData = new Promise<HumanModel>((resolve, reject) => {
      subscription.subscribe((result) => {
        if (result.data?.humanCreated) {
          resolve(result.data.humanCreated)
        }
        if (result.error) {
          reject(result.error as Error)
        }
      })
    })

    // Wait until the subscription is ready
    await sleep(100)

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

  afterAll(async () => {
    await client.clearStore()
    client.stop()
    await Promise.race([
      app.close(),
      new Promise(resolve => setTimeout(resolve, 500)),
    ])
  })
})
