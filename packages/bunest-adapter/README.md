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
  - [HTTPS](#https)
  - [Code Quality](#code-quality)
- [Request / Response Objects](#request--response-objects)
  - [BunRequest](#bunrequest)
  - [BunResponse](#bunresponse)
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
import { BunAdapter } from "@krisanalfa/bunest-adapter";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Server } from "bun";

import { AppModule } from "./app.module.js";

async function main() {
  const app = await NestFactory.create(AppModule, new BunAdapter());
  await app.listen(3000);
  const server = app.getHttpAdapter().getHttpServer() as Server<unknown>;
  Logger.log(`Server started on ${server.url.toString()}`, "NestApplication");
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
import { Controller, Sse, MessageEvent } from '@nestjs/common';
import { Observable, interval, map } from 'rxjs';

@Controller()
class EventsController {
  @Sse('/sse')
  sendEvents(): Observable<MessageEvent> {
    return interval(1000).pipe(
      map(num => ({
        data: `SSE message ${num.toString()}`,
      })),
    );
  }
}
```

**Client Connection Example:**

```ts
const eventSource = new EventSource('http://localhost:3000/sse');

eventSource.onopen = () => {
  console.log('SSE connection opened');
};

eventSource.onmessage = (event) => {
  console.log('Received:', event.data); // "SSE message 0", "SSE message 1", etc.
};

eventSource.onerror = (error) => {
  console.error('SSE error:', error);
  eventSource.close();
};

// Close the connection when done
// eventSource.close();
```

**For HTTPS/Secure Connections:**

```ts
import { EventSource } from 'eventsource'; // npm package for Node.js

const eventSource = new EventSource('https://localhost:3000/sse', {
  fetch: (url, init) => fetch(url, {
    ...init,
    tls: { rejectUnauthorized: false }, // For self-signed certificates
  }),
});

eventSource.onmessage = (event) => {
  console.log('Received:', event.data);
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
const app = await NestFactory.create(AppModule, new BunAdapter(), {
  cors: {
    origin: "https://example.com",
    methods: ["GET", "POST", "PUT"],
    credentials: true,
  },
});
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

const app = await NestFactory.create(AppModule, new BunAdapter());
app.use(helmet());
```

Tested and working with:

- `helmet` - Security headers
- `cors` - CORS handling
- And most other Express-compatible middleware

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
const app = await NestFactory.create(AppModule, new BunAdapter());
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
import { BunPreflightHttpServer } from "@krisanalfa/bunest-adapter";

@Injectable() // Mandatory to be able to inject `BunPreflightHttpServer`
@WebSocketGateway()
class BroadcastGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: BunPreflightHttpServer; // Inject BunPreflightHttpServer

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
    const count = this.server.getBunServer().subscriberCount(this.roomName);

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
import { BunAdapter, BunWsAdapter } from "@krisanalfa/bunest-adapter";
import { NestFactory } from "@nestjs/core";

const app = await NestFactory.create(
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
import { BunAdapter, BunWsAdapter } from "@krisanalfa/bunest-adapter";
import { NestFactory } from "@nestjs/core";

const app = await NestFactory.create(AppModule, new BunAdapter(), {
  httpsOptions: {
    cert: Bun.file("/path/to/cert.pem"),
    key: Bun.file("/path/to/key.pem"),
  },
});

app.useWebSocketAdapter(new BunWsAdapter(app));
await app.listen(3000);
```

**Unix Socket Support with WSS:**

You can also run secure WebSocket servers over Unix sockets:

```ts
import { BunAdapter, BunWsAdapter } from "@krisanalfa/bunest-adapter";
import { NestFactory } from "@nestjs/core";

const app = await NestFactory.create(
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
const app = await NestFactory.create(AppModule, new BunAdapter());
app.useWebSocketAdapter(new BunWsAdapter(app));
await app.listen(3000); // Both HTTP and WebSocket use port 3000
```

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
const app = await NestFactory.create(
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
const app = await NestFactory.create(
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
- Coverage reports (>97% line coverage, >85% function coverage)

## Request / Response Objects

The Bun adapter provides `BunRequest` and `BunResponse` classes that wrap Bun's native `Request` and `Response` objects, adding NestJS-specific functionality with performance optimizations through lazy parsing and caching.

### BunRequest

A high-performance request wrapper that provides lazy parsing and caching for optimal performance. Properties like `pathname`, `hostname`, `query`, and `headers` are only parsed when first accessed.

#### Properties

- **`url`** - The URL path and query string (e.g., "/api/users?page=1"). For the full URL including protocol and host, use `original().url`
- **`method`** - HTTP method (GET, POST, etc.)
- **`pathname`** - URL path (lazily parsed)
- **`hostname`** - Host name without port (lazily parsed, respects X-Forwarded-Host header)
- **`query`** - Parsed query parameters (lazily parsed)
- **`headers`** - Request headers object with `.get()` method (lazily materialized)
- **`params`** - Route parameters from URL patterns
- **`body`** - Parsed request body (set by body parser middleware)
- **`rawBody`** - Raw request body as ArrayBuffer
- **`file`** - Single uploaded file (for single file uploads)
- **`files`** - Multiple uploaded files (for multi-file uploads)
- **`signal`** - AbortSignal for request cancellation
- **`cookies`** - Cookie map for accessing request cookies
- **`socket`** - Mock socket object for Node.js compatibility (contains `encrypted` property)

#### Methods

- **`original()`** - Get the underlying native Bun request object
- **`get(key)`** - Get custom property stored in request
- **`set(key, value)`** - Set custom property in request (useful for middleware)
- **`json()`** - Parse body as JSON
- **`text()`** - Read body as text
- **`formData()`** - Parse body as FormData
- **`arrayBuffer()`** - Read body as ArrayBuffer
- **`blob()`** - Read body as Blob
- **`bytes()`** - Read body as Uint8Array
- **`clone()`** - Create a deep clone of the request

#### Usage Examples

```ts
@Controller("users")
class UsersController {
  @Get()
  findAll(@Req() req: BunRequest) {
    // Access query parameters
    const page = req.query.page; // Lazily parsed
    const limit = req.query.limit;

    // Access headers
    const auth = req.headers.get("authorization");
    const contentType = req.headers["content-type"];

    // Check if connection is secure
    const isSecure = req.socket.encrypted;

    return { page, limit, auth, isSecure };
  }

  @Post()
  create(@Req() req: BunRequest, @Body() dto: CreateUserDto) {
    // Access parsed body
    console.log(req.body); // Same as dto

    // Access request info
    console.log(req.url); // "/users" (pathname + search)
    console.log(req.pathname); // "/users"
    console.log(req.hostname); // "localhost"
    console.log(req.method); // "POST"

    // Access native request for full URL
    console.log(req.original().url); // "http://localhost:3000/users"

    return { created: dto };
  }

  @Post("upload")
  upload(@Req() req: BunRequest, @UploadedFile() file: File) {
    // Access uploaded file
    console.log(req.file?.name);
    console.log(req.file?.size);

    return { filename: file.name, size: file.size };
  }
}
```

**Storing custom data between middleware and handlers:**

```ts
@Injectable()
class AuthMiddleware implements NestMiddleware {
  use(req: BunRequest, res: BunResponse, next: () => void) {
    // Store user data in request
    req.set("user", { id: 1, name: "John" });
    req.set("requestTime", Date.now());
    next();
  }
}

@Controller("api")
class ApiController {
  @Get("profile")
  getProfile(@Req() req: BunRequest) {
    // Retrieve stored data
    const user = req.get("user");
    const requestTime = req.get("requestTime");

    return { user, requestTime };
  }
}
```

### BunResponse

A high-performance response builder that provides methods to construct responses with headers, cookies, and various body types. Uses lazy initialization and optimized response building for maximum performance. Includes Node.js compatibility methods for seamless integration with existing middleware.

#### Methods

- **`setStatus(code)`** - Set HTTP status code
- **`getStatus()`** - Get current status code
- **`setHeader(name, value)`** - Set a response header
- **`getHeader(name)`** - Get a response header value
- **`appendHeader(name, value)`** - Append value to existing header (comma-separated per RFC 9110)
- **`removeHeader(name)`** - Remove a response header
- **`cookie(name, value)`** - Set a cookie with name and value
- **`cookie(options)`** - Set a cookie with detailed options
- **`deleteCookie(name)`** - Delete a cookie by name
- **`deleteCookie(options)`** - Delete a cookie with path/domain options
- **`redirect(url, statusCode?)`** - Send redirect response (default 302)
- **`write(chunk)`** - Write data to response stream (Node.js compatibility). Chunks are accumulated until `end()` is called
- **`writeHead(statusCode, headers?)`** - Write status and headers (Node.js compatibility)
- **`end(body?)`** - End response and send body. Auto-handles JSON, streams, binary, [`BunFile`](https://bun.com/docs/runtime/file-io), and accumulated chunks from `write()` calls
- **`res()`** - Get the native Response promise
- **`isEnded()`** - Check if response has been ended

#### Node.js Compatibility Properties

For compatibility with Node.js HTTP response objects and EventEmitter-based middleware:

- **`destroyed`** - Always returns `false` (read-only property)
- **`on(event, listener)`** - No-op stub for EventEmitter compatibility
- **`off(event, listener)`** - No-op stub for EventEmitter compatibility
- **`once(event, listener)`** - No-op stub for EventEmitter compatibility
- **`destroy(error?)`** - No-op stub for Node.js compatibility

#### Usage Examples

**Setting status and headers:**

```ts
@Controller("api")
class ApiController {
  @Get("custom")
  custom(@Res() res: BunResponse) {
    res.setStatus(201);
    res.setHeader("X-Custom-Header", "custom-value");
    res.setHeader("Cache-Control", "no-cache");
    res.end({ message: "Success" });
  }

  @Get("append")
  appendHeaders(@Res() res: BunResponse) {
    res.setHeader("Cache-Control", "no-cache");
    res.appendHeader("Cache-Control", "no-store");
    // Results in: "Cache-Control: no-cache, no-store"
    res.end({ message: "Done" });
  }
}
```

**Working with cookies:**

```ts
@Controller("auth")
class AuthController {
  @Post("login")
  login(@Res() res: BunResponse) {
    // Simple cookie
    res.cookie("session", "abc123");

    // Cookie with options
    res.cookie({
      name: "auth",
      value: "token123",
      httpOnly: true,
      secure: true,
      maxAge: 3600000, // 1 hour
      path: "/",
      sameSite: "strict",
    });

    res.end({ message: "Logged in" });
  }

  @Post("logout")
  logout(@Res() res: BunResponse) {
    res.deleteCookie("session");
    res.deleteCookie("auth", { path: "/", domain: "example.com" });
    res.end({ message: "Logged out" });
  }
}
```

**Redirects:**

```ts
@Controller("redirect")
class RedirectController {
  @Get("temporary")
  temporaryRedirect(@Res() res: BunResponse) {
    res.redirect("/new-location"); // 302
  }

  @Get("permanent")
  @Redirect("https://example.com", 301) // Works too
  permanentRedirect(@Res() res: BunResponse) {
    //
  }
}
```

**Different response types:**

```ts
@Controller("files")
class FilesController {
  @Get("json")
  sendJson(@Res() res: BunResponse) {
    res.end({ data: [1, 2, 3] }); // Auto-serialized as JSON
  }

  @Get("empty")
  sendEmpty(@Res() res: BunResponse) {
    res.setStatus(204);
    res.end(); // No body
  }

  @Get("binary")
  sendBinary(@Res() res: BunResponse) {
    const buffer = new Uint8Array([1, 2, 3, 4, 5]);
    res.setHeader("Content-Type", "application/octet-stream");

  @Get("chunked")
  sendChunked(@Res() res: BunResponse) {
    // Node.js-style chunked response
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.write("Hello ");
    res.write("World");
    res.end("!"); // Sends "Hello World!"
  }

  @Get("mixed-chunks")
  sendMixedChunks(@Res() res: BunResponse) {
    // Mix of strings and binary data
    res.write("Status: ");
    res.write(new Uint8Array([50, 48, 48])); // "200" in bytes
    res.end(); // Chunks are combined and sent
  }
    res.end(buffer);
  }

  @Get("stream")
  sendStream(@Res() res: BunResponse) {
    const content = new TextEncoder().encode("File content");
    const file = new StreamableFile(content, {
      type: "text/plain",
      disposition: 'attachment; filename="file.txt"',
    });
    res.end(file);
  }
}
```

**Using with passthrough mode:**

```ts
@Controller("hybrid")
class HybridController {
  @Get("passthrough")
  withPassthrough(@Res({ passthrough: true }) res: BunResponse) {
    // Set headers/cookies but let NestJS handle the response
    res.setStatus(201);
    res.setHeader("X-Custom", "value");
    res.cookie("session", "abc123");

    // Return value will be serialized by NestJS
    return { message: "Created" };
  }

  @Get("manual")
  manualResponse(@Res() res: BunResponse) {
    // Full control - must call end()
    res.setStatus(200);
    res.end({ message: "Manual response" });
  }
}
```

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

## License

MIT License. See the [LICENSE](./LICENSE) file for details.
