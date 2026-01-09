/* eslint-disable sonarjs/no-nested-assignment */
import { CookieMap, BunRequest as NativeRequest, Server } from 'bun'
import { ParsedQs, parse } from 'qs'

// Optimized headers type - use native Headers for hot-path .get()
type HeadersProxy = Record<string, string> & {
  get: (key: string) => string | null
}

// Pre-allocated empty object for Object.create(null) pattern
const NULL_PROTO = Object.getPrototypeOf(Object.create(null)) as object

interface Connection {
  encrypted: boolean
}

interface TcpSocket {
  encrypted: boolean
  setKeepAlive: (enable?: boolean, initialDelay?: number) => void
  setNoDelay: (noDelay?: boolean) => void
  setTimeout: (timeout: number, callback?: () => void) => void
}

/**
 * A high-performance request wrapper for Bun's native request object.
 * Provides lazy parsing and caching for optimal performance in NestJS applications.
 *
 * @example
 * ```typescript
 * const bunRequest = new BunRequest(nativeRequest);
 * const pathname = bunRequest.pathname; // Lazily parsed
 * const query = bunRequest.query; // Parsed only when accessed
 * ```
 */
export class BunRequest {
  private _nativeHeaders: Headers
  private _headers: HeadersProxy | null = null
  private _hostname: string | null = null
  private _pathname: string | null = null
  private _query: ParsedQs | null = null
  private _body: unknown = null
  private _rawBody: ArrayBuffer | null = null
  private _file: File | null = null
  private _files: File[] | null = null
  private _settings: Map<string, unknown> | null = null
  private _connection: Connection | null = null
  private _socket: TcpSocket | null = null

  // Cache URL parts at construction time for hot-path access
  private _url: string | null = null
  private readonly _parsedUrl: URL
  readonly method: string
  readonly params: Record<string, string>

  constructor(private readonly nativeRequest: NativeRequest, public readonly server: Server<unknown>) {
    this._parsedUrl = new URL(nativeRequest.url)
    this._nativeHeaders = nativeRequest.headers
    this.method = nativeRequest.method
    this.params = nativeRequest.params
  }

  /**
   * Gets a mock connection object for compatibility with Node.js middleware.
   * Some middleware (like express-session) check req.connection.encrypted to determine if the connection is HTTPS.
   */
  get connection() {
    return this._connection ??= {
      encrypted: this._parsedUrl.protocol === 'https:' || this.nativeRequest.url.startsWith('https://'),
    }
  }

  /**
   * Gets a mock socket object for compatibility with Node.js middleware.
   * Some middleware (like Better Auth) check req.socket.encrypted to determine if the connection is HTTPS.
   */
  get socket() {
    return this._socket ??= {
      encrypted: this._parsedUrl.protocol === 'https:' || this.nativeRequest.url.startsWith('https://'),
      setKeepAlive: () => { /* no-op */ },
      setNoDelay: () => { /* no-op */ },
      setTimeout: () => { /* no-op */ },
    }
  }

  /**
   * Gets the URL path and query string of the request.
   * Returns the pathname + search params for Node.js/Express compatibility.
   * For the full URL including protocol and host, use the original() method to access the native request.
   *
   * @returns The URL path and query string (e.g., "/api/users?page=1")
   * @example
   * ```typescript
   * const url = request.url; // "/api/users?page=1"
   * // For full URL: request.original().url // "http://localhost:3000/api/users?page=1"
   * ```
   */
  get url(): string {
    return this._url ??= this._parsedUrl.pathname + this._parsedUrl.search
  }

  /**
   * Gets the original native Bun request object.
   *
   * @returns The underlying Bun request
   * @example
   * ```typescript
   * const nativeReq = request.original();
   * console.log(nativeReq.url); // Full URL with protocol and host
   * ```
   */
  original(): NativeRequest {
    return this.nativeRequest
  }

  /**
   * Gets the pathname portion of the URL.
   * Uses lazy parsing for optimal performance - the pathname is only extracted when first accessed.
   *
   * @returns The pathname component of the URL
   * @example
   * ```typescript
   * // For URL "http://localhost:3000/api/users?page=1"
   * const pathname = request.pathname; // "/api/users"
   * ```
   */
  get pathname(): string {
    return this._pathname ??= this._parsedUrl.pathname
  }

  /**
   * Gets the hostname portion of the URL.
   * Uses lazy parsing - the hostname is only extracted when first accessed.
   *
   * @returns The hostname component of the URL (without port)
   * @example
   * ```typescript
   * // For URL "http://localhost:3000/api/users"
   * const hostname = request.hostname; // "localhost"
   * ```
   */
  get hostname(): string {
    return this._hostname ??= this.headers.get('x-forwarded-host') ?? this._parsedUrl.hostname
  }

  /**
   * Gets all request headers as a key-value object.
   * Uses lazy parsing - headers are materialized only when first accessed.
   * All header keys are normalized to lowercase.
   *
   * @returns An object containing all headers with a .get() method for efficient lookups
   * @example
   * ```typescript
   * const headers = request.headers;
   * const contentType = headers['content-type']; // Direct access
   * const auth = headers.get('Authorization'); // Using .get() method
   * ```
   */
  get headers(): HeadersProxy {
    if (this._headers !== null) return this._headers
    const native = this._nativeHeaders
    // Create proxy that uses native .get() and materializes properties lazily
    const proxy = Object.create(NULL_PROTO) as HeadersProxy
    // Materialize all headers for NestJS decorators that iterate over keys
    native.forEach((value: string, key: string) => {
      proxy[key.toLowerCase()] = value
    })
    proxy.get = (key: string) => native.get(key)
    return this._headers = proxy
  }

  /**
   * Gets the parsed query parameters from the URL.
   * Uses lazy parsing - query string is only parsed when first accessed.
   *
   * @returns Parsed query parameters as an object
   * @example
   * ```typescript
   * // For URL "http://localhost:3000/api/users?page=1&limit=10"
   * const query = request.query;
   * console.log(query.page); // "1"
   * console.log(query.limit); // "10"
   * ```
   */
  get query(): ParsedQs {
    return this._query ??= parse(this._parsedUrl.searchParams.toString())
  }

  /**
   * Gets the parsed request body.
   *
   * @returns The parsed body content (could be JSON, form data, etc.)
   * @example
   * ```typescript
   * const body = request.body;
   * console.log(body); // { name: "John", email: "john@example.com" }
   * ```
   */
  get body(): unknown { return this._body }

  /**
   * Sets the parsed request body.
   * Typically used by body parser middleware.
   *
   * @param body - The parsed body content to set
   * @example
   * ```typescript
   * request.setBody({ name: "John", email: "john@example.com" });
   * ```
   */
  setBody(body: unknown): void { this._body = body }

  /**
   * Gets the raw request body as an ArrayBuffer.
   *
   * @returns The raw body data or null if not set
   * @example
   * ```typescript
   * const rawBody = request.rawBody;
   * if (rawBody) {
   *   const text = new TextDecoder().decode(rawBody);
   * }
   * ```
   */
  get rawBody(): ArrayBuffer | null { return this._rawBody }

  /**
   * Sets the raw request body as an ArrayBuffer.
   *
   * @param rawBody - The raw body data to set
   * @example
   * ```typescript
   * const buffer = await request.arrayBuffer();
   * request.setRawBody(buffer);
   * ```
   */
  setRawBody(rawBody: ArrayBuffer): void { this._rawBody = rawBody }

  /**
   * Gets the uploaded file from the request.
   * Used for single file uploads.
   *
   * @returns The uploaded file or null if no file was uploaded
   * @example
   * ```typescript
   * const file = request.file;
   * if (file) {
   *   console.log(file.name); // "avatar.png"
   *   console.log(file.size); // 2048
   * }
   * ```
   */
  get file(): File | null { return this._file }

  /**
   * Sets the uploaded file in the request.
   * Typically used by file upload middleware.
   *
   * @param file - The file to set
   * @example
   * ```typescript
   * const formData = await request.formData();
   * const file = formData.get('avatar') as File;
   * request.setFile(file);
   * ```
   */
  setFile(file: File): void { this._file = file }

  /**
   * Gets all uploaded files from the request.
   * Used for multiple file uploads.
   *
   * @returns Array of uploaded files or null if no files were uploaded
   * @example
   * ```typescript
   * const files = request.files;
   * if (files) {
   *   files.forEach(file => {
   *     console.log(file.name, file.size);
   *   });
   * }
   * ```
   */
  get files(): File[] | null { return this._files }

  /**
   * Sets multiple uploaded files in the request.
   * Typically used by file upload middleware.
   *
   * @param files - Array of files to set
   * @example
   * ```typescript
   * const formData = await request.formData();
   * const files = formData.getAll('attachments') as File[];
   * request.setFiles(files);
   * ```
   */
  setFiles(files: File[]): void { this._files = files }

  /**
   * Gets a custom setting/property stored in the request.
   * Useful for passing data between middleware and handlers.
   *
   * @param key - The setting key to retrieve
   * @returns The stored value or undefined if not found
   * @example
   * ```typescript
   * // In middleware
   * request.set('user', { id: 1, name: 'John' });
   *
   * // In handler
   * const user = request.get('user');
   * console.log(user); // { id: 1, name: 'John' }
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  get<T>(key: string): T | undefined {
    return this._settings?.get(key) as T | undefined
  }

  /**
   * Sets a custom setting/property in the request.
   * Useful for passing data between middleware and handlers.
   *
   * @param key - The setting key to store
   * @param value - The value to store
   * @example
   * ```typescript
   * request.set('user', { id: 1, name: 'John' });
   * request.set('startTime', Date.now());
   * ```
   */
  set(key: string, value: unknown): void {
    (this._settings ??= new Map()).set(key, value)
  }

  /**
   * Gets the AbortSignal for the request.
   * Can be used to detect if the request has been cancelled.
   *
   * @returns The request's AbortSignal
   * @example
   * ```typescript
   * const signal = request.signal;
   * signal.addEventListener('abort', () => {
   *   console.log('Request was cancelled');
   * });
   * ```
   */
  get signal(): AbortSignal { return this.nativeRequest.signal }

  /**
   * Gets the cookies from the request.
   *
   * @returns A Map-like object containing all cookies
   * @example
   * ```typescript
   * const cookies = request.cookies;
   * const sessionId = cookies.get('sessionId');
   * console.log(sessionId?.value);
   * ```
   */
  get cookies(): CookieMap { return this.nativeRequest.cookies }

  /**
   * Parses the request body as JSON.
   *
   * @returns Promise that resolves to the parsed JSON data
   * @example
   * ```typescript
   * const data = await request.json();
   * console.log(data); // { name: "John", email: "john@example.com" }
   * ```
   */
  json(): Promise<unknown> { return this.nativeRequest.json() }

  /**
   * Reads the request body as text.
   *
   * @returns Promise that resolves to the body text
   * @example
   * ```typescript
   * const text = await request.text();
   * console.log(text); // "Hello, World!"
   * ```
   */
  text(): Promise<string> { return this.nativeRequest.text() }

  /**
   * Parses the request body as FormData.
   *
   * @returns Promise that resolves to the parsed FormData
   * @example
   * ```typescript
   * const formData = await request.formData();
   * const name = formData.get('name');
   * console.log(name); // "John"
   * ```
   */
  formData(): Promise<FormData> { return this.nativeRequest.formData() as unknown as Promise<FormData> }

  /**
   * Reads the request body as an ArrayBuffer.
   *
   * @returns Promise that resolves to the body as ArrayBuffer
   * @example
   * ```typescript
   * const buffer = await request.arrayBuffer();
   * console.log(buffer.byteLength); // 1024
   * ```
   */
  arrayBuffer(): Promise<ArrayBuffer> { return this.nativeRequest.arrayBuffer() }

  /**
   * Reads the request body as a Blob.
   *
   * @returns Promise that resolves to the body as Blob
   * @example
   * ```typescript
   * const blob = await request.blob();
   * console.log(blob.type); // "image/png"
   * ```
   */
  blob(): Promise<Blob> { return this.nativeRequest.blob() }

  /**
   * Reads the request body as a Uint8Array.
   *
   * @returns Promise that resolves to the body as Uint8Array
   * @example
   * ```typescript
   * const bytes = await request.bytes();
   * console.log(bytes.length); // 1024
   * ```
   */
  bytes(): Promise<Uint8Array> { return this.nativeRequest.bytes() }

  /**
   * Creates a deep clone of the request.
   * Clones both the native request and all cached properties.
   *
   * @returns A new BunRequest instance with cloned data
   * @example
   * ```typescript
   * const originalRequest = new BunRequest(nativeRequest);
   * const clonedRequest = originalRequest.clone();
   *
   * // Modifications to clone don't affect original
   * clonedRequest.set('user', { id: 1 });
   * console.log(originalRequest.get('user')); // undefined
   * ```
   */
  clone(): BunRequest {
    const cloned = new BunRequest(this.nativeRequest.clone(), this.server)
    // _nativeHeaders and _parsedUrl are set in constructor
    cloned._hostname = this._hostname
    cloned._pathname = this._pathname
    cloned._query = this._query
    cloned._body = this._body
    cloned._rawBody = this._rawBody
    cloned._file = this._file
    cloned._files = this._files
    cloned._headers = this._headers
    cloned._settings = this._settings
    cloned._connection = this._connection
    cloned._socket = this._socket
    cloned._url = this._url
    // Other public properties are set in constructor
    return cloned
  }

  /**
   * Stub method for Node.js EventEmitter compatibility.
   * This is a no-op method provided for compatibility with Node.js HTTP request objects.
   * Required for SSE and other streaming scenarios where NestJS listens for request events.
   *
   * @param event - The event name
   * @param listener - The event listener function
   * @returns This request object for chaining
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  on(event: string, listener: (...args: unknown[]) => void): this {
    // No-op for compatibility
    return this
  }

  /**
   * Stub method for Node.js EventEmitter compatibility.
   * This is a no-op method provided for compatibility with Node.js HTTP request objects.
   *
   * @param event - The event name
   * @param listener - The event listener function
   * @returns This request object for chaining
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  once(event: string, listener: (...args: unknown[]) => void): this {
    // No-op for compatibility
    return this
  }

  /**
   * Stub method for Node.js EventEmitter compatibility.
   * This is a no-op method provided for compatibility with Node.js HTTP request objects.
   *
   * @param event - The event name
   * @param listener - The event listener function
   * @returns This request object for chaining
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  off(event: string, listener: (...args: unknown[]) => void): this {
    // No-op for compatibility
    return this
  }

  /**
   * Stub method for Node.js EventEmitter compatibility.
   * This is a no-op method provided for compatibility with Node.js HTTP request objects.
   *
   * @param event - The event name
   * @param args - Event arguments
   * @returns True to indicate the event was handled
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  emit(event: string, ...args: unknown[]): boolean {
    // No-op for compatibility - return true to indicate event was handled
    return true
  }
}
