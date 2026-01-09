import { Args, Field, GraphQLModule, ID, ObjectType, Query, Resolver } from '@nestjs/graphql'
import { Logger, Module, NotFoundException } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'

import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo'

@ObjectType()
class HumanModel {
  @Field(() => ID)
  id!: string

  @Field(() => String)
  name!: string
}

const DB: HumanModel[] = [
  { id: '1', name: 'John Doe' },
  { id: '2', name: 'Jane Doe' },
]

@Resolver(HumanModel)
class HumanResolver {
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
}

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      graphiql: true,
      autoSchemaFile: true,
    }),
  ],
  providers: [HumanResolver],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class AppModule {}

const main = async () => {
  const app = await NestFactory.create(
    AppModule,
  )
  await app.listen(3000, '127.0.0.1')
  Logger.log(`Server started on http://localhost:3000/graphql`, 'NestApplication')
}

await main()
