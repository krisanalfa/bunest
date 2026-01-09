/* eslint-disable sonarjs/no-identical-functions */
import { ApolloClient, HttpLink, InMemoryCache, gql } from '@apollo/client'
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo'
import { Args, Field, GraphQLModule, ID, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql'
import {
  ArgumentsHost,
  BadRequestException,
  CallHandler,
  CanActivate,
  Catch,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Module,
  NestInterceptor,
  PipeTransform,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { GqlArgumentsHost, GqlExceptionFilter, GqlExecutionContext } from '@nestjs/graphql'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Observable } from 'rxjs'
import { Test } from '@nestjs/testing'
import { map } from 'rxjs/operators'

import { BunAdapter } from '../../bun.adapter.js'
import { BunRequest } from '../../bun.request.js'
import { NestBunApplication } from '../../bun.internal.types.js'

import { BunYogaDriver, BunYogaDriverConfig } from '../../bun.yoga.driver.js'

// ============================================================================
// Models
// ============================================================================

@ObjectType()
class TaskModel {
  @Field(() => ID)
  id!: string

  @Field(() => String)
  title!: string

  @Field(() => String)
  status!: string

  @Field(() => Number)
  priority!: number
}

@ObjectType()
class ResponseTaskModel {
  @Field(() => TaskModel)
  data!: TaskModel

  @Field(() => Number)
  timestamp!: number
}

// ============================================================================
// Custom Guards
// ============================================================================

@Injectable()
class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const ctx = GqlExecutionContext.create(context)
    const { req } = ctx.getContext<{ req: BunRequest }>()

    // Check for auth token in headers
    const authToken = req.headers.get('authorization')
    return authToken === 'Bearer valid-token'
  }
}

@Injectable()
class RoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const ctx = GqlExecutionContext.create(context)
    const { req } = ctx.getContext<{ req: BunRequest }>()

    // Check for admin role
    const role = req.headers.get('x-role')
    return role === 'admin'
  }
}

// ============================================================================
// Custom Interceptors
// ============================================================================

interface Response<T> {
  data: T
  timestamp: number
}

@Injectable()
class TransformInterceptor<T> implements NestInterceptor<T, Response<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<Response<T>> {
    return next.handle().pipe(
      map(data => ({
        data,
        timestamp: Date.now(),
      })),
    )
  }
}

@Injectable()
class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    const ctx = GqlExecutionContext.create(context)
    const info = ctx.getInfo<{ fieldName: string }>()

    // Log the field name being accessed
    const fieldName = info.fieldName

    return next.handle().pipe(
      map((data) => {
        // Add a logged field to verify interceptor ran
        if (data && typeof data === 'object') {
          return { ...(data as Record<string, unknown>), _logged: fieldName }
        }
        return data
      }),
    )
  }
}

// ============================================================================
// Custom Exception Filters
// ============================================================================

class CustomNotFoundException extends HttpException {
  constructor(message: string) {
    super(
      {
        statusCode: HttpStatus.NOT_FOUND,
        message,
        error: 'CustomNotFound',
      },
      HttpStatus.NOT_FOUND,
    )
  }
}

class CustomBadRequestException extends HttpException {
  constructor(message: string) {
    super(
      {
        statusCode: HttpStatus.BAD_REQUEST,
        message,
        error: 'CustomBadRequest',
      },
      HttpStatus.BAD_REQUEST,
    )
  }
}

@Catch(CustomNotFoundException)
class CustomNotFoundExceptionFilter implements GqlExceptionFilter {
  catch(exception: CustomNotFoundException, host: ArgumentsHost) {
    const gqlHost = GqlArgumentsHost.create(host)
    const info = gqlHost.getInfo<{ fieldName: string }>()

    // Return a modified exception with additional context
    return new HttpException(
      {
        message: exception.message,
        field: info.fieldName,
        customError: true,
      },
      HttpStatus.NOT_FOUND,
    )
  }
}

@Catch(CustomBadRequestException)
class CustomBadRequestExceptionFilter implements GqlExceptionFilter {
  catch(exception: CustomBadRequestException, host: ArgumentsHost) {
    GqlArgumentsHost.create(host)

    // Return a modified exception
    return new HttpException(
      {
        message: exception.message,
        customBadRequest: true,
      },
      HttpStatus.BAD_REQUEST,
    )
  }
}

// ============================================================================
// Custom Pipes
// ============================================================================

@Injectable()
class ParseIntPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const val = parseInt(value, 10)
    if (isNaN(val)) {
      throw new BadRequestException(`Validation failed: "${value}" is not a valid integer`)
    }
    return val
  }
}

@Injectable()
class UpperCasePipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string') {
      throw new BadRequestException('Value must be a string')
    }
    return value.toUpperCase()
  }
}

@Injectable()
class ValidateStatusPipe implements PipeTransform<string, string> {
  private readonly allowedStatuses = ['pending', 'in-progress', 'completed']

  transform(value: string): string {
    if (!this.allowedStatuses.includes(value)) {
      throw new BadRequestException(
        `Status must be one of: ${this.allowedStatuses.join(', ')}`,
      )
    }
    return value
  }
}

// ============================================================================
// In-memory database
// ============================================================================

const TASKS_DB: TaskModel[] = [
  { id: '1', title: 'Task 1', status: 'pending', priority: 1 },
  { id: '2', title: 'Task 2', status: 'completed', priority: 2 },
]

// Reset database to initial state (for test isolation between suites)
function resetDatabase() {
  TASKS_DB.length = 0
  TASKS_DB.push(
    { id: '1', title: 'Task 1', status: 'pending', priority: 1 },
    { id: '2', title: 'Task 2', status: 'completed', priority: 2 },
  )
}

// ============================================================================
// Resolvers
// ============================================================================

@Resolver(() => TaskModel)
class TaskResolver {
  // Test Guard
  @Query(() => TaskModel, { name: 'taskWithAuth' })
  @UseGuards(AuthGuard)
  getTaskWithAuth(@Args('id', { type: () => ID }) id: string): TaskModel {
    const task = TASKS_DB.find(t => t.id === id)
    if (!task) {
      throw new CustomNotFoundException(`Task with id ${id} not found`)
    }
    return task
  }

  // Test Multiple Guards
  @Query(() => TaskModel, { name: 'taskWithRole' })
  @UseGuards(AuthGuard, RoleGuard)
  getTaskWithRole(@Args('id', { type: () => ID }) id: string): TaskModel {
    const task = TASKS_DB.find(t => t.id === id)
    if (!task) {
      throw new CustomNotFoundException(`Task with id ${id} not found`)
    }
    return task
  }

  // Test Interceptor
  @Query(() => ResponseTaskModel, { name: 'taskWithInterceptor' })
  @UseInterceptors(TransformInterceptor)
  getTaskWithInterceptor(@Args('id', { type: () => ID }) id: string): TaskModel {
    const task = TASKS_DB.find(t => t.id === id)
    if (!task) {
      throw new CustomNotFoundException(`Task with id ${id} not found`)
    }
    return task
  }

  // Test Logging Interceptor
  @Query(() => TaskModel, { name: 'taskWithLogging' })
  @UseInterceptors(LoggingInterceptor)
  getTaskWithLogging(@Args('id', { type: () => ID }) id: string): TaskModel {
    const task = TASKS_DB.find(t => t.id === id)
    if (!task) {
      throw new CustomNotFoundException(`Task with id ${id} not found`)
    }
    return task
  }

  // Test Exception Filter
  @Query(() => TaskModel, { name: 'taskWithFilter' })
  @UseFilters(CustomNotFoundExceptionFilter)
  getTaskWithFilter(@Args('id', { type: () => ID }) id: string): TaskModel {
    const task = TASKS_DB.find(t => t.id === id)
    if (!task) {
      throw new CustomNotFoundException(`Task with id ${id} not found`)
    }
    return task
  }

  // Test Pipes - ParseIntPipe
  @Query(() => TaskModel, { name: 'taskByPriority' })
  getTaskByPriority(@Args('priority', ParseIntPipe) priority: number): TaskModel {
    const task = TASKS_DB.find(t => t.priority === priority)
    if (!task) {
      throw new CustomNotFoundException(`Task with priority ${String(priority)} not found`)
    }
    return task
  }

  // Test Mutation with Pipes
  @Mutation(() => TaskModel, { name: 'createTask' })
  @UseFilters(CustomBadRequestExceptionFilter)
  createTask(
    @Args('title', UpperCasePipe) title: string,
    @Args('status', ValidateStatusPipe) status: string,
    @Args('priority', ParseIntPipe) priority: number,
  ): TaskModel {
    const newTask: TaskModel = {
      id: (TASKS_DB.length + 1).toString(),
      title,
      status,
      priority,
    }
    TASKS_DB.push(newTask)
    return newTask
  }

  // Test Mutation with Guards and Interceptors
  @Mutation(() => TaskModel, { name: 'updateTask' })
  @UseGuards(AuthGuard)
  @UseInterceptors(LoggingInterceptor)
  updateTask(
    @Args('id', { type: () => ID }) id: string,
    @Args('title') title: string,
  ): TaskModel {
    const task = TASKS_DB.find(t => t.id === id)
    if (!task) {
      throw new CustomNotFoundException(`Task with id ${id} not found`)
    }
    task.title = title
    return task
  }

  // Test combined: Guards + Interceptors + Filters + Pipes
  @Mutation(() => ResponseTaskModel, { name: 'complexUpdateTask' })
  @UseGuards(AuthGuard, RoleGuard)
  @UseInterceptors(TransformInterceptor)
  @UseFilters(CustomNotFoundExceptionFilter)
  complexUpdateTask(
    @Args('id', { type: () => ID }) id: string,
    @Args('title', UpperCasePipe) title: string,
    @Args('priority', ParseIntPipe) priority: number,
  ): TaskModel {
    const task = TASKS_DB.find(t => t.id === id)
    if (!task) {
      throw new CustomNotFoundException(`Task with id ${id} not found`)
    }
    task.title = title
    task.priority = priority
    return task
  }
}

@Module({
  providers: [TaskResolver],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class TaskModule {}

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      autoTransformHttpErrors: true,
    }),
    TaskModule,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class AppModule {}

@Module({
  imports: [
    GraphQLModule.forRoot<BunYogaDriverConfig>({
      driver: BunYogaDriver,
      autoSchemaFile: true,
      autoTransformHttpErrors: true,
    }),
    TaskModule,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class YogaAppModule {}

// ============================================================================
// Tests
// ============================================================================

// Shared test suite factory
function createGraphQLTestSuite(
  driverName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AppModuleClass: any,
  adapterOptions: { withGraphQL?: boolean } = {},
) {
  describe(`BunAdapter GraphQL (${driverName}) - Guards, Interceptors, Filters, and Pipes`, () => {
    let app: NestBunApplication

    let client: ApolloClient

    beforeAll(async () => {
      // Reset database to ensure test isolation between suites
      resetDatabase()

      const moduleRef = await Test.createTestingModule({
        imports: [AppModuleClass],
      }).compile()

      app = moduleRef.createNestApplication<NestBunApplication>(
        new BunAdapter(adapterOptions),
      )
      await app.listen(0)
      const server = app.getHttpServer().getBunServer()
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const url = server!.url.toString()

      const httpLink = new HttpLink({
        uri: `${url}graphql`,
        // @ts-expect-error Bun's fetch doesn't support preconnect
        fetch: (url, options) => {
          return fetch(url, {
            ...options,
          })
        },
      })

      client = new ApolloClient({
        link: httpLink,
        cache: new InMemoryCache(),
      })
    })

    describe('Guards', () => {
      it('should deny access when auth guard fails', async () => {
        try {
          await client.query({
            query: gql`
              query GetTaskWithAuth($id: ID!) {
                taskWithAuth(id: $id) {
                  id
                  title
                }
              }
            `,
            variables: { id: '1' },
            context: {
              headers: {},
            },
          })
          expect(true).toBe(false) // Should not reach here
        }
        catch (error) {
          expect((error as Error).message).toContain('Forbidden')
        }
      })

      it('should allow access when auth guard passes', async () => {
        const result = await client.query<{ taskWithAuth: TaskModel }>({
          query: gql`
            query GetTaskWithAuth($id: ID!) {
              taskWithAuth(id: $id) {
                id
                title
                status
              }
            }
          `,
          variables: { id: '1' },
          context: {
            headers: {
              authorization: 'Bearer valid-token',
            },
          },
        })

        expect(result.data?.taskWithAuth).toBeDefined()
        expect(result.data?.taskWithAuth.id).toBe('1')
        expect(result.data?.taskWithAuth.title).toBe('Task 1')
      })

      it('should deny access when role guard fails', async () => {
        try {
          await client.query({
            query: gql`
              query GetTaskWithRole($id: ID!) {
                taskWithRole(id: $id) {
                  id
                  title
                }
              }
            `,
            variables: { id: '1' },
            context: {
              headers: {
                authorization: 'Bearer valid-token',
              },
            },
          })
          expect(true).toBe(false) // Should not reach here
        }
        catch (error) {
          expect((error as Error).message).toContain('Forbidden')
        }
      })

      it('should allow access when both auth and role guards pass', async () => {
        const result = await client.query<{ taskWithRole: TaskModel }>({
          query: gql`
            query GetTaskWithRole($id: ID!) {
              taskWithRole(id: $id) {
                id
                title
                status
              }
            }
          `,
          variables: { id: '1' },
          context: {
            headers: {
              'authorization': 'Bearer valid-token',
              'x-role': 'admin',
            },
          },
        })

        expect(result.data?.taskWithRole).toBeDefined()
        expect(result.data?.taskWithRole.id).toBe('1')
      })
    })

    describe('Interceptors', () => {
      it('should transform response with TransformInterceptor', async () => {
        const result = await client.query<{ taskWithInterceptor: Response<TaskModel> }>({
          query: gql`
            query GetTaskWithInterceptor($id: ID!) {
              taskWithInterceptor(id: $id) {
                data {
                  id
                  title
                }
                timestamp
              }
            }
          `,
          variables: { id: '1' },
        })

        expect(result.data?.taskWithInterceptor).toBeDefined()
        expect(result.data?.taskWithInterceptor.data).toBeDefined()
        expect(result.data?.taskWithInterceptor.data.id).toBe('1')
        expect(result.data?.taskWithInterceptor.timestamp).toBeGreaterThan(0)
      })

      it('should add logging metadata with LoggingInterceptor', async () => {
        const result = await client.query<{
          taskWithLogging: TaskModel
        }>({
          query: gql`
            query GetTaskWithLogging($id: ID!) {
              taskWithLogging(id: $id) {
                id
                title
                status
              }
            }
          `,
          variables: { id: '1' },
        })

        expect(result.data?.taskWithLogging).toBeDefined()
        expect(result.data?.taskWithLogging.id).toBe('1')
      })
    })

    describe('Exception Filters', () => {
      it('should handle CustomNotFoundException with filter', async () => {
        try {
          await client.query({
            query: gql`
              query GetTaskWithFilter($id: ID!) {
                taskWithFilter(id: $id) {
                  id
                  title
                }
              }
            `,
            variables: { id: '999' },
          })
          expect(true).toBe(false) // Should not reach here
        }
        catch (error) {
          const message = (error as Error).message
          expect(message).toContain('Task with id 999 not found')
        }
      })

      it('should apply custom filter to mutation', async () => {
        try {
          await client.mutate({
            mutation: gql`
              mutation CreateTask($title: String!, $status: String!, $priority: Float!) {
                createTask(title: $title, status: $status, priority: $priority) {
                  id
                  title
                }
              }
            `,
            variables: {
              title: 'test',
              status: 'invalid-status',
              priority: 1,
            },
          })
          expect(true).toBe(false) // Should not reach here
        }
        catch (error) {
          const message = (error as Error).message
          expect(message).toContain('Status must be one of')
        }
      })
    })

    describe('Pipes', () => {
      it('should parse integer with ParseIntPipe', async () => {
        const result = await client.query<{ taskByPriority: TaskModel }>({
          query: gql`
            query GetTaskByPriority($priority: Float!) {
              taskByPriority(priority: $priority) {
                id
                title
                priority
              }
            }
          `,
          variables: { priority: 1 },
        })

        expect(result.data?.taskByPriority).toBeDefined()
        expect(result.data?.taskByPriority.priority).toBe(1)
      })

      it('should fail when ParseIntPipe receives invalid input', async () => {
        try {
          await client.query({
            query: gql`
              query GetTaskByPriority($priority: Float!) {
                taskByPriority(priority: $priority) {
                  id
                  title
                }
              }
            `,
            variables: { priority: null as unknown as number },
          })
          expect(true).toBe(false) // Should not reach here
        }
        catch (error) {
          const message = (error as Error).message
          expect(message).toContain('Variable')
        }
      })

      it('should transform title with UpperCasePipe', async () => {
        const result = await client.mutate<{ createTask: TaskModel }>({
          mutation: gql`
            mutation CreateTask($title: String!, $status: String!, $priority: Float!) {
              createTask(title: $title, status: $status, priority: $priority) {
                id
                title
                status
                priority
              }
            }
          `,
          variables: {
            title: 'new task',
            status: 'pending',
            priority: 5,
          },
        })

        expect(result.data?.createTask).toBeDefined()
        expect(result.data?.createTask.title).toBe('NEW TASK')
        expect(result.data?.createTask.priority).toBe(5)
      })

      it('should validate status with ValidateStatusPipe', async () => {
        try {
          await client.mutate({
            mutation: gql`
              mutation CreateTask($title: String!, $status: String!, $priority: Float!) {
                createTask(title: $title, status: $status, priority: $priority) {
                  id
                  title
                }
              }
            `,
            variables: {
              title: 'test',
              status: 'invalid',
              priority: 1,
            },
          })
          expect(true).toBe(false) // Should not reach here
        }
        catch (error) {
          const message = (error as Error).message
          expect(message).toContain('Status must be one of')
        }
      })
    })

    describe('Combined Features', () => {
      it('should work with guards and interceptors on mutations', async () => {
        const result = await client.mutate<{
          updateTask: TaskModel
        }>({
          mutation: gql`
            mutation UpdateTask($id: ID!, $title: String!) {
              updateTask(id: $id, title: $title) {
                id
                title
                status
              }
            }
          `,
          variables: {
            id: '1',
            title: 'Updated Task',
          },
          context: {
            headers: {
              authorization: 'Bearer valid-token',
            },
          },
        })

        expect(result.data?.updateTask).toBeDefined()
        expect(result.data?.updateTask.title).toBe('Updated Task')
      })

      it('should combine guards, interceptors, filters, and pipes', async () => {
        const result = await client.mutate<{
          complexUpdateTask: Response<TaskModel>
        }>({
          mutation: gql`
            mutation ComplexUpdateTask($id: ID!, $title: String!, $priority: Float!) {
              complexUpdateTask(id: $id, title: $title, priority: $priority) {
                data {
                  id
                  title
                  priority
                }
                timestamp
              }
            }
          `,
          variables: {
            id: '1',
            title: 'complex update',
            priority: 10,
          },
          context: {
            headers: {
              'authorization': 'Bearer valid-token',
              'x-role': 'admin',
            },
          },
        })

        expect(result.data?.complexUpdateTask).toBeDefined()
        expect(result.data?.complexUpdateTask.data.title).toBe('COMPLEX UPDATE')
        expect(result.data?.complexUpdateTask.data.priority).toBe(10)
        expect(result.data?.complexUpdateTask.timestamp).toBeGreaterThan(0)
      })

      it('should fail complex operation when guards fail', async () => {
        try {
          await client.mutate({
            mutation: gql`
              mutation ComplexUpdateTask($id: ID!, $title: String!, $priority: Float!) {
                complexUpdateTask(id: $id, title: $title, priority: $priority) {
                  data {
                    id
                    title
                  }
                  timestamp
                }
              }
            `,
            variables: {
              id: '1',
              title: 'test',
              priority: 1,
            },
            context: {
              headers: {
                authorization: 'Bearer valid-token',
                // Missing x-role header
              },
            },
          })
          expect(true).toBe(false) // Should not reach here
        }
        catch (error) {
          expect((error as Error).message).toContain('Forbidden')
        }
      })

      it('should handle errors with custom filters in complex operations', async () => {
        try {
          await client.mutate({
            mutation: gql`
              mutation ComplexUpdateTask($id: ID!, $title: String!, $priority: Float!) {
                complexUpdateTask(id: $id, title: $title, priority: $priority) {
                  data {
                    id
                    title
                  }
                  timestamp
                }
              }
            `,
            variables: {
              id: '999',
              title: 'test',
              priority: 1,
            },
            context: {
              headers: {
                'authorization': 'Bearer valid-token',
                'x-role': 'admin',
              },
            },
          })
          expect(true).toBe(false) // Should not reach here
        }
        catch (error) {
          const message = (error as Error).message
          expect(message).toContain('Task with id 999 not found')
        }
      })
    })

    afterAll(async () => {
      await client.clearStore()
      client.stop()
      await Promise.race([app.close(), new Promise(resolve => setTimeout(resolve, 500))])
    })
  })
}

// Run test suites for both drivers
createGraphQLTestSuite('Apollo', AppModule, { withGraphQL: true })
createGraphQLTestSuite('Yoga', YogaAppModule, {})
