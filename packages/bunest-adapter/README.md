# Native Bun Adapter for NestJS

This project provides a native Bun adapter for NestJS, allowing developers to leverage the performance benefits of the Bun runtime while using the powerful features of the NestJS framework.

## Table of Contents

- [Features](#features)
  - [Native Bun adapter for NestJS](#native-bun-adapter-for-nestjs)
  - [Full NestJS Feature Support](#full-nestjs-feature-support)
    - [Controllers & HTTP Methods](#controllers--http-methods)
    - [Middleware](#middleware)
    - [Guards](#guards)
    - [Interceptors](#interceptors)
    - [Exception Filters](#exception-filters)
    - [Validation](#validation)
    - [File Uploads](#file-uploads)
    - [Streaming Responses](#streaming-responses)
    - [Server-Sent Events (SSE)](#server-sent-events-sse)
    - [Versioning](#versioning)
    - [CORS](#cors)
    - [Cookies](#cookies)
    - [Popular Express Middleware](#popular-express-middleware)
    - [Static Assets](#static-assets)
  - [Bun File API Support](#bun-file-api-support)
    - [BunFileInterceptor](#bunfileinterceptor)
  - [WebSocket Support](#websocket-support)
    - [Basic WebSocket Gateway](#basic-websocket-gateway)
    - [WebSocket with Guards](#websocket-with-guards)
    - [WebSocket with Pipes](#websocket-with-pipes)
    - [WebSocket with Exception Filters](#websocket-with-exception-filters)
    - [Broadcasting Messages](#broadcasting-messages)
    - [Secure WebSocket (WSS)](#secure-websocket-wss)
    - [Limitations](#limitations)
  - [GraphQL Support](#graphql-support)
    - [Basic GraphQL Setup](#basic-graphql-setup)
    - [GraphQL with Subscriptions](#graphql-with-subscriptions)
  - [GraphQL Yoga Driver (Recommended)](#graphql-yoga-driver-recommended)
    - [Why GraphQL Yoga?](#why-graphql-yoga)
    - [Basic Setup](#basic-setup)
    - [Configuration Options](#configuration-options)
    - [Complete Example with Resolvers](#complete-example-with-resolvers)
    - [Field Middleware Support](#field-middleware-support)
    - [Subscriptions with Custom Headers](#subscriptions-with-custom-headers)
    - [Error Handling](#error-handling)
    - [BunYogaDriver Limitations](#bunyogadriver-limitations)
  - [GraphQL Limitations (General)](#graphql-limitations-general)
  - [HTTPS](#https)
  - [Code Quality](#code-quality)
- [Benchmark Results](#benchmark-results)
  - [HTTP Benchmark](#http-benchmark)
  - [WebSocket Benchmark](#websocket-benchmark)
  - [Running HTTP Benchmark](#running-http-benchmark)
  - [Running WebSocket Benchmark](#running-websocket-benchmark)
- [Contributing](#contributing)
- [Future Plans](#future-plans)
- [License](#license)

## Features

### Native Bun adapter for NestJS

Easy to set up and use Bun as the underlying HTTP server for your NestJS applications.

```ts
import { BunAdapter, NestBunApplication } from "@krisanalfa/bunest-adapter";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Server } from "bun";

import { AppModule } from "./app.module.js";

async function main() {
  const app = await NestFactory.create<NestBunApplication>(
    AppModule,
    new BunAdapter(),
  );
  await app.listen(3000);
  const server = app.getHttpServer().getBunServer();
  Logger.log(
    `Server started on ${server?.url.toString() ?? "http://localhost:3000"}`,
    "NestApplication",
  );
}

await main();
```

You can also listen on Unix sockets:

```ts
await app.listen("/tmp/nestjs-bun.sock");

// Using Bun's fetch API to make requests over the Unix socket
fetch("http://localhost/", {
  unix: "/tmp/nestjs-bun.sock",
});
```

Or even an abstract namespace socket on Linux:

```ts
await app.listen("\0nestjs-bun-abstract-socket");
```

To configure the underlying Bun server options, you can pass them to the `BunAdapter` constructor:

```ts
new BunAdapter({
  id: "my-nestjs-bun-server",
  development: true,
  maxRequestBodySize: 10 * 1024 * 1024, // 10 MB
  idleTimeout: 120_000, // 2 minutes
  tls: {}, // TLS options here (read more about TLS options in the HTTPS section)
});
```

Since Bun only supports these HTTP methods:

- GET
- POST
- PUT
- DELETE
- PATCH
- OPTIONS
- HEAD

... the Bun adapter will throw an error if you try to use unsupported methods like ALL, COPY or SEARCH.

```ts
@Controller("example")
class ExampleController {
  @All() // This won't work with Bun adapter
  handleAllMethods() {
    //
  }
}
```

However, you can still define consumer middleware to use these methods as needed.

```ts
@Controller("example")
class ExampleController {
  @Get()
  getExample() {
    return { message: "This works!" };
  }
}

class ExampleMiddleware implements NestMiddleware {
  use(req: BunRequest, res: BunResponse, next: () => void) {
    // Middleware logic here
    // You may send response directly if needed
    res.end("Middleware response");
    next();
  }
}

@Module({
  controllers: [ExampleController],
  providers: [ExampleMiddleware],
})
class ExampleModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ExampleMiddleware).forRoutes({
      path: "example",
      method: RequestMethod.ALL,
    });
  }
}

const response = fetch("http://localhost:3000/example", {
  method: "TRACE", // This will be handled by the middleware
});
console.log(await response.text()); // Outputs: "Middleware response"
```

### Full NestJS Feature Support

The Bun adapter supports all major NestJS features including:

#### Controllers & HTTP Methods

Full support for all HTTP methods and decorators:

```ts
@Controller("users", { host: ":account.example.com" } /* Works too */)
class UsersController {
  @Get()
  findAll(@Query("search") search?: string) {
    return { users: [] };
  }

  @Post()
  create(@Body() data: CreateUserDto) {
    return { created: data };
  }

  @Get(":id")
  findOne(@Param("id", ParseIntPipe) id: number) {
    return { user: { id } };
  }

  @Put(":id")
  update(@Param("id") id: string, @Body() data: UpdateUserDto) {
    return { updated: data };
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return { deleted: id };
  }

  @Patch(":id")
  partialUpdate(
    @HostParam("account") account: string, // Works too
    @Param("id") id: string,
    @Body() data: Partial<UpdateUserDto>,
  ) {
    return { updated: data };
  }
}
```

##### Notes on `@HostParam()` and `host` Controller option

The BunRequest's hostname always trusts the proxy headers (like `X-Forwarded-Host`) since Bun itself does not provide direct access to the raw socket information. When this header is not present, it falls back to the `Host` header. Ensure that your application is behind a trusted proxy when using `X-Forwarded-Host` to avoid host header injection attacks.

In express.js, you would typically configure trusted proxies using `app.set('trust proxy', true)`. See the docs [here](https://expressjs.com/en/guide/behind-proxies.html). But in Bun, this is not applicable. In the future, we may provide a way to configure trusted proxies directly in the Bun adapter. But for now, be cautious when using `@HostParam()` in untrusted environments.

#### Middleware

Full middleware support with route exclusion and global middleware:

```ts
@Module({
  controllers: [DummyController, AnotherDummyController],
  providers: [DummyMiddleware],
})
class DummyModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(DummyMiddleware)
      .exclude({
        path: "/dummy/skip",
        method: RequestMethod.GET,
      })
      .forRoutes(DummyController);
    consumer.apply(GlobalMiddleware).forRoutes("*");
  }
}
```

#### Guards

Protect routes with guards:

```ts
@Injectable()
class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<BunRequest>();
    return request.headers.get("authorization") !== null;
  }
}

@Controller("protected")
class ProtectedController {
  @Get()
  @UseGuards(AuthGuard)
  getData() {
    return { data: "secret" };
  }
}
```

#### Interceptors

Including support for cancellable requests:

```ts
@Injectable()
class CancellableInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<BunRequest>();
    const signal = request.signal;
    const close$ = fromEvent(signal, "abort");

    return next.handle().pipe(
      takeUntil(
        close$.pipe(
          mergeMap(async () => {
            // Cleanup on request cancellation
          }),
        ),
      ),
      defaultIfEmpty(null),
    );
  }
}
```

#### Exception Filters

Custom exception handling:

```ts
@Catch(HttpException)
class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<BunResponse>();
    const request = ctx.getRequest<BunRequest>();
    const status = exception.getStatus();

    response.setStatus(status);
    response.end({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.pathname,
      message: exception.message,
    });
  }
}

// Usage
app.useGlobalFilters(new HttpExceptionFilter());
```

#### Validation

Full support for class-validator and pipes:

```ts
class CreateUserDto {
  @IsString()
  name!: string;

  @IsNumber()
  @Min(0)
  age!: number;
}

@Controller("users")
class UsersController {
  @Post()
  create(@Body() dto: CreateUserDto) {
    return { created: dto };
  }
}

// Enable validation globally
app.useGlobalPipes(new ValidationPipe());
```

#### File Uploads

Native file upload support using File API:

```ts
@Controller("upload")
class UploadController {
  @Post("single")
  uploadFile(@UploadedFile("file") file: File) {
    return { filename: file.name, size: file.size };
  }

  @Post("multiple")
  uploadFiles(@UploadedFiles() files: File[]) {
    return files.map((f) => ({ filename: f.name, size: f.size }));
  }
}
```

To work with Bun's native `BunFile` API for uploads, consider using the `BunFileInterceptor` provided by this package (see the Bun File API Support section below).

#### Streaming Responses

Support for [`StreamableFile`](https://docs.nestjs.com/techniques/streaming-files#streamable-file-class):

```ts
@Controller("files")
class FilesController {
  @Get("download")
  @Header("Content-Type", "text/plain")
  download() {
    const buffer = new TextEncoder().encode("File content");
    return new StreamableFile(buffer, {
      type: "text/plain",
      disposition: 'attachment; filename="file.txt"',
    });
  }
}
```

#### Server-Sent Events (SSE)

Full support for [Server-Sent Events](https://docs.nestjs.com/techniques/server-sent-events) using the `@Sse()` decorator. SSE allows servers to push real-time updates to clients over HTTP:

```ts
import { Controller, Sse, MessageEvent } from "@nestjs/common";
import { Observable, interval, map } from "rxjs";

@Controller()
class EventsController {
  @Sse("/sse")
  sendEvents(): Observable<MessageEvent> {
    return interval(1000).pipe(
      map((num) => ({
        data: `SSE message ${num.toString()}`,
      })),
    );
  }
}
```

**Client Connection Example:**

```ts
const eventSource = new EventSource("http://localhost:3000/sse");

eventSource.onopen = () => {
  console.log("SSE connection opened");
};

eventSource.onmessage = (event) => {
  console.log("Received:", event.data); // "SSE message 0", "SSE message 1", etc.
};

eventSource.onerror = (error) => {
  console.error("SSE error:", error);
  eventSource.close();
};

// Close the connection when done
// eventSource.close();
```

**For HTTPS/Secure Connections:**

```ts
import { EventSource } from "eventsource"; // npm package for Node.js

const eventSource = new EventSource("https://localhost:3000/sse", {
  fetch: (url, init) =>
    fetch(url, {
      ...init,
      tls: { rejectUnauthorized: false }, // For self-signed certificates
    }),
});

eventSource.onmessage = (event) => {
  console.log("Received:", event.data);
};
```

#### Versioning

Full API [versioning](https://docs.nestjs.com/techniques/versioning) support (URI, Header, Media Type, Custom):

```ts
// URI Versioning
app.enableVersioning({
  type: VersioningType.URI,
});

@Controller("cats")
@Version("1")
class CatsControllerV1 {
  @Get()
  findAll() {
    return { version: "1", cats: [] };
  }
}

@Controller("cats")
@Version("2")
class CatsControllerV2 {
  @Get()
  findAll() {
    return { version: "2", cats: [], pagination: true };
  }
}

// Access via: /v1/cats and /v2/cats
```

#### CORS

Built-in CORS support with dynamic configuration:

```ts
// Simple CORS
app.enableCors();

// Advanced CORS with dynamic options
app.enableCors((req: BunRequest, callback) => {
  const origin = req.headers.get("origin");

  if (origin === "https://allowed.example.com") {
    callback(null, {
      origin: true,
      credentials: true,
      methods: ["GET", "POST"],
    });
  } else {
    callback(null, { origin: false });
  }
});
```

You can also use NestJS's `CorsOptions` type for static configuration.

```ts
const app = await NestFactory.create<NestBunApplication>(
  AppModule,
  new BunAdapter(),
  {
    cors: {
      origin: "https://example.com",
      methods: ["GET", "POST", "PUT"],
      credentials: true,
    },
  },
);
```

#### Cookies

Full cookie support:

```ts
@Controller()
class CookiesController {
  @Get("set")
  setCookie(@Res({ passthrough: true }) response: BunResponse) {
    response.cookie("session", "abc123", {
      httpOnly: true,
      maxAge: 3600000,
    });
    return { message: "Cookie set" };
  }

  @Get("get")
  getCookie(@Req() request: BunRequest) {
    const session = request.cookies.get("session");
    return { session };
  }
}
```

#### Popular Express Middleware

Compatible with popular Express middleware:

```ts
import helmet from "helmet";

const app = await NestFactory.create<NestBunApplication>(
  AppModule,
  new BunAdapter(),
);
app.use(helmet());
```

Tested and working with:

- `helmet` - Security headers
- `cors` - CORS handling
- `@thallesp/nestjs-better-auth` - `better-auth` middleware
- `express-session` - Session management

#### Static Assets

Serve static files from your NestJS application using Bun's native file serving capabilities. The adapter supports two distinct modes:

**File Routes (Default)** - Reads files from the filesystem on each request, supports range requests, respects middlewares, and provides full HTTP feature compatibility:

```ts
import { join } from "path";

const app = await NestFactory.create<NestBunApplication>(
  AppModule,
  new BunAdapter(),
);

// Serve static assets using file routes (default)
app.useStaticAssets(join(__dirname, "public"));

// Or explicitly set useStatic to false
app.useStaticAssets(join(__dirname, "public"), { useStatic: false });

await app.listen(3000);

// Files in 'public' directory are now accessible:
// public/index.html -> http://localhost:3000/index.html
// public/css/style.css -> http://localhost:3000/css/style.css
// public/images/logo.png -> http://localhost:3000/images/logo.png
```

> Note: Even if the file routes read the files from the filesystem on each request, you still need to make sure that Bun has access to the files right before you call `app.listen()`. The adapter reads the directory structure and prepares the routes at that time. If you need different behavior (e.g., dynamic files), consider using a custom controller to serve those files.

**Static Routes** - Serves files directly from memory for maximum performance, but with some limitations (no range requests, doesn't respect middlewares):

```ts
import { join } from "path";

const app = await NestFactory.create<NestBunApplication>(
  AppModule,
  new BunAdapter(),
);

// Serve static assets using static routes (faster, but with limitations)
app.useStaticAssets(join(__dirname, "public"), { useStatic: true });

await app.listen(3000);
```

**With CORS Support:**

```ts
const app = await NestFactory.create<NestBunApplication>(
  AppModule,
  new BunAdapter(),
  { cors: true },
);

// Static assets will respect CORS settings when using file routes
app.useStaticAssets(join(__dirname, "public"), { useStatic: false });
```

**Choosing Between Modes:**

For more details, see [Bun's documentation on file responses vs static responses](https://bun.sh/docs/runtime/http/routing#file-responses-vs-static-responses).

### WebSocket Support

The Bun adapter provides full WebSocket support using Bun's native WebSocket implementation. The `BunWsAdapter` enables real-time, bidirectional communication between clients and servers with excellent performance.

#### Basic WebSocket Gateway

Create WebSocket gateways using NestJS decorators:

```ts
import { BunWsAdapter, BunAdapter } from "@krisanalfa/bunest-adapter";
import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
} from "@nestjs/websockets";
import { ServerWebSocket } from "bun";

@WebSocketGateway({ cors: true })
class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  handleConnection(client: ServerWebSocket) {
    client.send(JSON.stringify({ event: "welcome", data: "Welcome!" }));
  }

  handleDisconnect(client: ServerWebSocket) {
    console.log("Client disconnected");
  }

  @SubscribeMessage("message")
  handleMessage(@MessageBody() data: string) {
    return {
      event: "message",
      data: `Received: ${data}`,
    };
  }
}

// Enable WebSocket support in your application
const app = await NestFactory.create<NestBunApplication>(
  AppModule,
  new BunAdapter(),
);
app.useWebSocketAdapter(new BunWsAdapter(app));
await app.listen(3000);
```

Connect from the client:

```ts
const socket = new WebSocket("ws://localhost:3000");

socket.onopen = () => {
  socket.send(JSON.stringify({ event: "message", data: "Hello!" }));
};

socket.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data); // { event: 'message', data: 'Received: Hello!' }
};
```

#### WebSocket with Guards

Protect WebSocket endpoints with guards:

```ts
import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { WsException } from "@nestjs/websockets";

@Injectable()
class WsAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const data = context.switchToWs().getData<{ token?: string }>();

    if (data.token !== "valid-token") {
      throw new WsException("Unauthorized");
    }

    return true;
  }
}

@WebSocketGateway()
@UseGuards(WsAuthGuard)
class ProtectedGateway {
  @SubscribeMessage("protected")
  handleProtected(@MessageBody() data: { message: string }) {
    return {
      event: "protected",
      data: `Protected message: ${data.message}`,
    };
  }
}
```

#### WebSocket with Pipes

Validate WebSocket messages using pipes:

```ts
import { UsePipes, ValidationPipe } from "@nestjs/common";
import { IsString, IsNotEmpty, MinLength } from "class-validator";

class CreateMessageDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  text!: string;
}

@WebSocketGateway()
@UsePipes(
  new ValidationPipe({
    exceptionFactory: (errors) => new WsException(errors),
  }),
)
class ValidationGateway {
  @SubscribeMessage("createMessage")
  handleCreateMessage(@MessageBody() dto: CreateMessageDto) {
    return {
      event: "messageCreated",
      data: dto.text,
    };
  }
}
```

#### WebSocket with Exception Filters

Handle WebSocket exceptions with custom filters:

```ts
import { Catch, ArgumentsHost, WsExceptionFilter } from "@nestjs/common";
import { WsException } from "@nestjs/websockets";
import { ServerWebSocket } from "bun";

@Catch(WsException)
class WsExceptionsFilter implements WsExceptionFilter {
  catch(exception: WsException, host: ArgumentsHost) {
    const client = host.switchToWs().getClient<ServerWebSocket>();
    const error = exception.getError();
    const details = typeof error === "object" ? error : { message: error };

    client.send(
      JSON.stringify({
        event: "error",
        data: {
          message: "An error occurred",
          details,
        },
      }),
    );
  }
}

@WebSocketGateway()
@UseFilters(WsExceptionsFilter)
class ErrorHandlingGateway {
  @SubscribeMessage("risky")
  handleRisky(@MessageBody() data: { shouldFail: boolean }) {
    if (data.shouldFail) {
      throw new WsException("Something went wrong");
    }
    return { event: "success", data: "OK" };
  }
}
```

#### Broadcasting Messages

Broadcast messages to all connected clients using Bun's publish/subscribe system:

```ts
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
} from "@nestjs/websockets";
import { ServerWebSocket } from "bun";
import { BunServerInstance } from "@krisanalfa/bunest-adapter";

@Injectable() // Mandatory to be able to inject `BunServerInstance`
@WebSocketGateway()
class BroadcastGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: BunServerInstance; // Inject BunServerInstance

  private readonly roomName = "global-room";

  handleConnection(client: ServerWebSocket) {
    // Subscribe client to room
    client.subscribe(this.roomName);
  }

  @SubscribeMessage("broadcast")
  handleBroadcast(
    @MessageBody() message: string,
    @ConnectedSocket() socket: ServerWebSocket,
  ) {
    // Get subscriber count
    const count = this.server.getBunServer()?.subscriberCount(this.roomName);

    // Publish to all subscribers in the room
    socket.publishText(
      this.roomName,
      JSON.stringify({
        event: "broadcast",
        data: message,
        subscribers: count,
      }),
    );
  }
}
```

**Key Features:**

- **Native Performance** - Uses Bun's native WebSocket implementation for maximum speed
- **NestJS Integration** - Full support for decorators, guards, pipes, and exception filters
- **Pub/Sub Support** - Built-in support for broadcasting messages to multiple clients
- **CORS Configuration** - Easy CORS setup for WebSocket connections
- **HTTP + WebSocket** - Run both HTTP and WebSocket servers on the same port

#### Secure WebSocket (WSS)

The Bun adapter supports secure WebSocket connections (WSS) using TLS/SSL certificates. You can configure WSS in two ways:

**Using BunAdapter constructor options:**

```ts
import {
  BunAdapter,
  BunWsAdapter,
  NestBunApplication,
} from "@krisanalfa/bunest-adapter";
import { NestFactory } from "@nestjs/core";

const app = await NestFactory.create<NestBunApplication>(
  AppModule,
  new BunAdapter({
    tls: {
      cert: Bun.file("/path/to/cert.pem"),
      key: Bun.file("/path/to/key.pem"),
    },
  }),
);

app.useWebSocketAdapter(new BunWsAdapter(app));
await app.listen(3000);

// Clients connect using wss:// protocol
// const ws = new WebSocket('wss://localhost:3000');
```

**Using NestFactory.create httpsOptions:**

```ts
import {
  BunAdapter,
  BunWsAdapter,
  NestBunApplication,
} from "@krisanalfa/bunest-adapter";
import { NestFactory } from "@nestjs/core";

const app = await NestFactory.create<NestBunApplication>(
  AppModule,
  new BunAdapter(),
  {
    httpsOptions: {
      cert: Bun.file("/path/to/cert.pem"),
      key: Bun.file("/path/to/key.pem"),
    },
  },
);

app.useWebSocketAdapter(new BunWsAdapter(app));
await app.listen(3000);
```

**Unix Socket Support with WSS:**

You can also run secure WebSocket servers over Unix sockets:

```ts
import {
  BunAdapter,
  BunWsAdapter,
  NestBunApplication,
} from "@krisanalfa/bunest-adapter";
import { NestFactory } from "@nestjs/core";

const app = await NestFactory.create<NestBunApplication>(
  AppModule,
  new BunAdapter({
    tls: {
      cert: Bun.file("/path/to/cert.pem"),
      key: Bun.file("/path/to/key.pem"),
    },
  }),
);

app.useWebSocketAdapter(new BunWsAdapter(app));
await app.listen("/tmp/secure-nestjs.sock");

// Or use abstract namespace socket on Linux
await app.listen("\0secure-nestjs-socket");
```

**Client Connection Example:**

```ts
// For development with self-signed certificates
const ws = new WebSocket("wss://localhost:3000", {
  tls: { rejectUnauthorized: false },
});

ws.onopen = () => {
  console.log("Connected to secure WebSocket");
  ws.send(JSON.stringify({ event: "message", data: "Hello WSS!" }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log("Received:", data);
};
```

**Important Notes:**

- WSS automatically uses the same port as your HTTPS server
- The `wss://` protocol is used instead of `ws://` for secure connections
- For production, use properly signed certificates from a trusted Certificate Authority
- For development, you can use self-signed certificates with `rejectUnauthorized: false` on the client

#### Limitations

**Port Configuration:** The WebSocket server port will always be the same as the Bun HTTP server port. In standard NestJS, you can configure different ports via the `@WebSocketGateway` decorator's `port` option (see [NestJS WebSocket documentation](https://docs.nestjs.com/websockets/gateways#overview)), but with the Bun adapter, WebSocket connections must use the same port as your HTTP server. This is due to Bun's unified server architecture where HTTP and WebSocket upgrades are handled by the same server instance.

```ts
// This port option is ignored with BunWsAdapter
@WebSocketGateway({ port: 8080 }) // ⚠️ Port option has no effect
class ChatGateway {
  // Gateway will use the same port as app.listen()
}

// WebSocket will be available on the same port as HTTP
const app = await NestFactory.create<NestBunApplication>(
  AppModule,
  new BunAdapter(),
);
app.useWebSocketAdapter(new BunWsAdapter(app));
await app.listen(3000); // Both HTTP and WebSocket use port 3000
```

### GraphQL Support

The Bun adapter provides full support for GraphQL using the `@nestjs/apollo` package. Due to Apollo Server's internal dependency on Express-specific features, you need to enable GraphQL compatibility mode by setting the `withGraphQL` option in the `BunAdapter` constructor.

#### Basic GraphQL Setup

To use GraphQL with the Bun adapter, you need to:

1. Install the required dependencies:

```bash
bun add @nestjs/apollo @nestjs/graphql @apollo/server graphql
```

2. Enable GraphQL support in the adapter:

```ts
import { BunAdapter, NestBunApplication } from "@krisanalfa/bunest-adapter";
import { NestFactory } from "@nestjs/core";
import { Module } from "@nestjs/common";
import { GraphQLModule } from "@nestjs/graphql";
import { ApolloDriver, ApolloDriverConfig } from "@nestjs/apollo";

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
    }),
  ],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create<NestBunApplication>(
    AppModule,
    new BunAdapter({
      withGraphQL: true, // Enable GraphQL compatibility mode
    }),
  );
  await app.listen(3000);
}

bootstrap();
```

**What does `withGraphQL` do?**

When you set `withGraphQL: true`, the Bun adapter:

- Overrides the `getType()` method to return `'express'` instead of `'bun'`, which allows Apollo Server to work correctly
- Ensures compatibility with NestJS's GraphQL module internals that expect Express or Fastify

**Basic GraphQL Example:**

```ts
import {
  Resolver,
  Query,
  Args,
  ID,
  Field,
  ObjectType,
  Mutation,
} from "@nestjs/graphql";
import { Injectable, NotFoundException } from "@nestjs/common";

@ObjectType()
class User {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;

  @Field(() => String)
  email!: string;
}

@Resolver(() => User)
@Injectable()
class UserResolver {
  private users: User[] = [
    { id: "1", name: "John Doe", email: "john@example.com" },
    { id: "2", name: "Jane Smith", email: "jane@example.com" },
  ];

  @Query(() => User, { name: "user" })
  getUser(@Args("id", { type: () => ID }) id: string): User {
    const user = this.users.find((u) => u.id === id);
    if (!user) {
      throw new NotFoundException(`User with id ${id} not found`);
    }
    return user;
  }

  @Query(() => [User], { name: "users" })
  getUsers(): User[] {
    return this.users;
  }

  @Mutation(() => User, { name: "createUser" })
  createUser(
    @Args("name", { type: () => String }) name: string,
    @Args("email", { type: () => String }) email: string,
  ): User {
    const newUser = {
      id: (this.users.length + 1).toString(),
      name,
      email,
    };
    this.users.push(newUser);
    return newUser;
  }
}
```

Access your GraphQL playground at `http://localhost:3000/graphql` and execute queries:

```graphql
query GetUser {
  user(id: "1") {
    id
    name
    email
  }
}

mutation CreateUser {
  createUser(name: "Alice", email: "alice@example.com") {
    id
    name
    email
  }
}
```

#### GraphQL with Subscriptions

The Bun adapter supports GraphQL subscriptions using Bun's native WebSocket implementation. To enable subscriptions, you need to provide a custom WebSocket handler to the `withGraphQL` option:

```bash
bun add graphql-subscriptions graphql-ws
```

```ts
import { BunAdapter, NestBunApplication } from "@krisanalfa/bunest-adapter";
import { NestFactory } from "@nestjs/core";
import { GraphQLModule, GraphQLSchemaHost } from "@nestjs/graphql";
import { ApolloDriver, ApolloDriverConfig } from "@nestjs/apollo";
import { makeHandler } from "graphql-ws/use/bun";
import { Module, Injectable } from "@nestjs/common";
import { Resolver, Query, Mutation, Subscription, Args } from "@nestjs/graphql";
import { PubSub } from "graphql-subscriptions";

const pubSub = new PubSub();

@Resolver()
class NotificationResolver {
  @Query(() => String)
  hello(): string {
    return "Hello World!";
  }

  @Mutation(() => Boolean)
  async publishNotification(
    @Args("message") message: string,
  ): Promise<boolean> {
    await pubSub.publish("notificationSent", { notificationSent: message });
    return true;
  }

  @Subscription(() => String, { name: "notificationSent" })
  notificationSent() {
    return pubSub.asyncIterableIterator("notificationSent");
  }
}

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      subscriptions: {
        "graphql-ws": true,
      },
    }),
  ],
  providers: [NotificationResolver],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create<NestBunApplication>(
    AppModule,
    new BunAdapter({
      withGraphQL: {
        // Spread the WebSocket handlers from graphql-ws
        ...makeHandler({
          schema: () => {
            const schemaHost = app.get(GraphQLSchemaHost);
            return schemaHost.schema;
          },
        }),
      },
    }),
  );
  await app.listen(3000);
}

bootstrap();
```

**Client Example:**

```ts
import {
  ApolloClient,
  InMemoryCache,
  HttpLink,
  ApolloLink,
  gql,
} from "@apollo/client";
import { GraphQLWsLink } from "@apollo/client/link/subscriptions";
import { createClient } from "graphql-ws";
import { OperationTypeNode } from "graphql";

const httpLink = new HttpLink({
  uri: "http://localhost:3000/graphql",
});

const wsLink = new GraphQLWsLink(
  createClient({
    url: "ws://localhost:3000/graphql",
  }),
);

// Split links based on operation type
const splitLink = ApolloLink.split(
  ({ operationType }) => operationType === OperationTypeNode.SUBSCRIPTION,
  wsLink,
  httpLink,
);

const client = new ApolloClient({
  link: splitLink,
  cache: new InMemoryCache(),
});

// Subscribe to notifications
client
  .subscribe({
    query: gql`
      subscription OnNotification {
        notificationSent
      }
    `,
  })
  .subscribe({
    next: (data) => console.log("Received:", data),
    error: (error) => console.error("Error:", error),
  });

// Trigger a notification
await client.mutate({
  mutation: gql`
    mutation PublishNotification($message: String!) {
      publishNotification(message: $message)
    }
  `,
  variables: { message: "Hello from subscription!" },
});
```

### GraphQL Yoga Driver (Recommended)

For better performance, we provide a native `BunYogaDriver` that uses [GraphQL Yoga](https://the-guild.dev/graphql/yoga-server) instead of Apollo Server. **This driver is ~35% faster than Apollo Server** and utilizes all Bun's native features without compatibility layers.

| Framework                       | Requests per Second |
|---------------------------------|---------------------|
| Bun Adapter + Apollo Server     | 16066.2553 rps      |
| Bun Adapter + GraphQL Yoga      | 21773.3745 rps      |
| Express Adapter + Apollo Server | 12523.1951 rps      |

#### Basic Setup

1. Install the required dependencies:

```bash
bun add @nestjs/graphql graphql graphql-yoga
# If you need subscriptions support:
bun add graphql-ws
```

2. Configure your application with `BunYogaDriver`:

```ts
import {
  BunAdapter,
  BunYogaDriver,
  BunYogaDriverConfig,
  NestBunApplication,
} from "@krisanalfa/bunest-adapter";
import { Module } from "@nestjs/common";
import { GraphQLModule } from "@nestjs/graphql";
import { NestFactory } from "@nestjs/core";

@Module({
  imports: [
    GraphQLModule.forRoot<BunYogaDriverConfig>({
      driver: BunYogaDriver,
      autoSchemaFile: true, // Required for schema generation
    }),
  ],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create<NestBunApplication>(
    AppModule,
    new BunAdapter(), // No need for withGraphQL option!
  );
  await app.listen(3000);
}

bootstrap();
```

> **Note:** Unlike Apollo Server, the `BunYogaDriver` does not require the `withGraphQL: true` option in the `BunAdapter` constructor.

#### Configuration Options

The `BunYogaDriverConfig` provides the following options:

```ts
GraphQLModule.forRoot<BunYogaDriverConfig>({
  driver: BunYogaDriver,

  // Required: Must be true to generate schema automatically
  autoSchemaFile: true,

  // Optional: Custom GraphQL endpoint path (default: '/graphql')
  path: "/graphql",

  // Optional: Enable GraphiQL interface for testing
  graphiql: true,

  // Optional: Enable WebSocket subscriptions
  subscriptions: {
    "graphql-ws": true,
  },

  // Optional: Transform HTTP exceptions to GraphQL errors with proper codes
  // When enabled, NestJS HttpExceptions are automatically mapped to GraphQL error codes:
  // - 400 Bad Request -> BAD_REQUEST
  // - 401 Unauthorized -> UNAUTHENTICATED
  // - 403 Forbidden -> FORBIDDEN
  // - 422 Unprocessable Entity -> BAD_USER_INPUT
  autoTransformHttpErrors: true,

  // Optional: Custom context factory for WebSocket connections
  clientDataFactory: (req) => {
    return { userId: req.headers.get("x-user-id") };
  },

  // Optional: Custom context for resolvers
  context: ({ request }) => ({
    // Add custom properties to the GraphQL context
    userAgent: request.headers.get("user-agent"),
  }),
});
```

#### BunYogaDriver Limitations

- **Code First Only**: Only supports the Code First approach with decorators. Schema First is not supported.
- **Subscriptions Protocol**: Only `graphql-ws` protocol is supported for subscriptions.

### GraphQL Limitations (General)

**Supported Drivers:** The Bun adapter supports Apollo GraphQL driver (`@nestjs/apollo`) and the native `BunYogaDriver`. Mercurius (`@nestjs/mercurius`) is not supported.

**Apollo GraphQL Subscriptions:** When using Apollo driver, subscriptions only work with `graphql-ws`. Custom configurations for `graphql-ws` defined in the GraphQL module (such as [authentication over WebSockets](https://docs.nestjs.com/graphql/subscriptions#authentication-over-websockets)) will not be applied.

**Workaround:** To customize `graphql-ws` behavior, use the `makeHandler` function from `graphql-ws/use/bun` when configuring the `withGraphQL` option:

```ts
import { makeHandler } from "graphql-ws/use/bun";

const app = await NestFactory.create<NestBunApplication>(
  AppModule,
  new BunAdapter({
    withGraphQL: {
      ...makeHandler({
        schema: () => {
          const schemaHost = app.get(GraphQLSchemaHost);
          return schemaHost.schema;
        },
        // Add your custom graphql-ws options here
        onConnect: async (ctx) => {
          // Custom authentication logic
          const token = ctx.connectionParams?.authToken;
          if (!token) {
            throw new Error("Missing auth token!");
          }
          // Verify token and return user context
          return { user: await validateToken(token) };
        },
        context: (ctx) => {
          // Access authenticated user in resolvers
          return { user: ctx.extra.user };
        },
      }),
      clientDataFactory: (req) => {
        // Optional: extract data from initial HTTP request
        return { uid: req.headers.get("x-user-id") };
      },
    },
  }),
);
```

**Code First Only:** The GraphQL support currently works with the Code First (decorators) approach only. Schema First approach is not yet supported.

### Bun File API Support

This package provides first-class support for Bun's native [`BunFile`](https://bun.com/docs/runtime/file-io) API, enabling seamless file uploads and downloads using Bun's efficient file handling capabilities.

#### BunFileInterceptor

The `BunFileInterceptor` is a NestJS interceptor that processes file uploads using Bun's native `BunFile` API. It automatically saves uploaded files to a temporary directory and attaches them to the request object, making them available in your controller methods via the `@UploadedFile()` or `@UploadedFiles()` decorators.

**How it works:**

- When a request with file uploads is received, the interceptor:

  - Saves each uploaded file to a directory set in `BUN_UPLOAD_DIR` environment variables. If not set, it falls back to a unique temporary directory (using Bun's `Bun.write` and `randomUUIDv7()` for isolation). Here's how we determine the upload path if `BUN_UPLOAD_DIR` is not set:

  ```ts
  import { tempdir } from "os";
  import { join } from "path";
  import { randomUUIDv7 } from "bun";
  const uploadPath = join(tempdir(), "uploads", SERVER_ID, randomUUIDv7());
  ```

  `SERVER_ID` is a unique identifier for the Bun server instance, ensuring that uploads from different server instances do not conflict. See the [Bun documentation](https://bun.com/docs/runtime/http/server#reference) for more details on server id.

  - Replaces the uploaded file(s) in the request with Bun's `BunFile` objects pointing to the saved files.

#### Usage Example

```ts
@Controller()
class UploadController {
  @Post("single")
  @UseInterceptors(BunFileInterceptor)
  uploadSingle(
    @Res({ passthrough: true }) res: BunResponse,
    @UploadedFile() file?: BunFile,
  ) {
    res.end(file); // Optimized to send BunFile directly
  }

  @Post("multiple")
  @UseInterceptors(BunFileInterceptor)
  uploadMultiple(
    @UploadedFiles() files: BunFile[],
    @Res({ passthrough: true }) res: BunResponse,
  ) {
    // Return the last file for demonstration
    res.end(files[files.length - 1]);
  }
}
```

**Best Practices:**
You should never use the `BunFileInterceptor` globally, as it incurs overhead for all requests. Instead, apply it only to specific routes that handle file uploads.

### HTTPS

You can run your NestJS application with HTTPS using two approaches:

#### Using Bun's built-in HTTPS support (recommended)

```ts
const app = await NestFactory.create<NestBunApplication>(
  AppModule,
  new BunAdapter({
    tls: {
      cert: Bun.file("/path/to/cert.pem"),
      key: Bun.file("/path/to/key.pem"),
    },
  }),
);
```

#### Using NestJS App Factory HTTPS options

```ts
const app = await NestFactory.create<NestBunApplication>(
  AppModule,
  new BunAdapter(/* leave it empty */),
  {
    httpsOptions: {
      cert: fs.readFileSync("/path/to/cert.pem"), // works with Bun too
      key: Bun.file("/path/to/key.pem"), // you can use Bun.file here as well
    },
  },
);
```

##### Limitations

If you're using NestJS's built-in HTTPS options, only these options will be passed to Bun:

- `key`
- `cert`
- `ca`
- `passphrase`
- `ciphers`
- `secureOptions`
- `requestCert`

Other options will be ignored.

### Code Quality

The Bun adapter is developed with high code quality standards, including:

- Strict TypeScript typings
- Strict linting rules (ESLint)
- Comprehensive unit and integration tests
- Coverage reports (>95% line coverage, >80% function coverage)

## Benchmark Results

Tested on MacOS Sequoia (15.6.1), Apple M1 Max (64GB RAM), Bun 1.3.5, Node.js 20.10.0.

### HTTP Benchmark

HTTP benchmarks run using [`oha`](https://github.com/hatoo/oha) tool with the following command:

```
oha -c 125 -n 1000000 --no-tui "http://127.0.0.1:3000/"
```

| Configuration                                                                     | Requests/sec | Compared to Pure Bun |
| --------------------------------------------------------------------------------- | -----------: | -------------------: |
| Pure Bun                                                                          |    80,742.72 |              100.00% |
| Nest + Bun + Native Bun Adapter                                                   |    70,234.76 |               86.98% |
| Nest + Bun + Express Adapter                                                      |    43,375.97 |               53.72% |
| Nest + Bun + [Hono Adapter](https://www.npmjs.com/package/@kiyasov/platform-hono) |    19,194.78 |               23.77% |
| Nest + Node + Express                                                             |    14,019.88 |               17.36% |

> **Pure Bun** is the fastest at **80,743 req/s**. **Nest + Bun + Native Bun Adapter** achieves **~86%** of Pure Bun's performance while providing full NestJS features, and is **~5x faster** than Nest + Node + Express. Compared to Bun with Express adapter, the native Bun adapter is **~1.6x faster**.

Bonus if you use Unix sockets:

```
Summary:
  Success rate:	100.00%
  Total:	8298.2243 ms
  Slowest:	5.2326 ms
  Fastest:	0.2857 ms
  Average:	1.0361 ms
  Requests/sec:	120507.7092

  Total data:	21.93 MiB
  Size/request:	23 B
  Size/sec:	2.64 MiB
```

As you can see, using Unix sockets boosts the performance further to **120,508 req/s**, which is **~1.5x faster** than TCP. Since Bun `fetch` supports Unix sockets, you can leverage this for inter-process communication on the same machine.

### WebSocket Benchmark

WebSocket benchmarks run using the custom benchmark script in `benchmarks/ws.benchmark.ts`.

| Configuration                      | Messages/sec | Compared to Pure Bun |
| ---------------------------------- | -----------: | -------------------: |
| Pure Bun WebSocket                 |   817,594.60 |              100.00% |
| Nest + Bun + BunWsAdapter          |   764,962.70 |               93.56% |
| Nest + Bun + WebSocketAdapter (ws) |   299,161.50 |               36.59% |

> **Pure Bun WebSocket** achieves **817,595 msg/s**. **Nest + Bun + BunWsAdapter** achieves **~94%** of Pure Bun's performance, and is **~2.6x faster** than using the standard WebSocketAdapter with `ws` library.

### Running HTTP Benchmark

This project includes benchmark configurations in the `benchmarks` directory.
To run the specific HTTP server benchmark, you can use predefined scripts in `package.json`:

```bash
# Running native bun server benchmark
bun run http:native

# Running NestJS with Bun adapter benchmark
bun run http:bun

# Running NestJS with Hono adapter benchmark
bun run http:hono

# Running NestJS with Express adapter benchmark
bun run http:express

# Running NestJS with Node and Express benchmark
bun run http:node
```

Then run the benchmark using [`oha`](https://github.com/hatoo/oha):

```bash
oha -c 125 -n 1000000 --no-tui "http://127.0.0.1:3000/"
```

### Running WebSocket Benchmark

To run WebSocket benchmarks, first start the WebSocket server:

```bash
# Running native bun websocket benchmark
bun run ws:native

# Running NestJS with BunWsAdapter websocket benchmark
bun run ws:bun

# Running NestJS with WebSocketAdapter (ws) websocket benchmark
bun run ws:ws
```

Then run the benchmark script:

```bash
bun benchmarks/ws.benchmark.ts
```

All benchmarks use port `3000` by default. You can adjust the port in the respective benchmark files if needed.

## Contributing

Contributions are welcome! Please open issues or submit pull requests for bug fixes, improvements, or new features.

## Future Plans

- Enhanced trusted proxy configuration for host header handling
- Improved documentation and examples
- Release automation via CI/CD pipelines
- Separate package for GraphQL Yoga support with Bun
- Improve code coverage to 100%

## License

MIT License. See the [LICENSE](./LICENSE) file for details.
