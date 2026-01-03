/* eslint-disable sonarjs/no-nested-assignment */
import { BodyInit, Cookie, CookieInit, CookieMap, CookieStoreDeleteOptions } from 'bun'
import { StreamableFile } from '@nestjs/common'

// Pre-allocated JSON content type header
const JSON_CONTENT_TYPE = 'application/json'

/**
 * A high-performance response builder for Bun's native Response object.
 * Provides methods to build responses with headers, cookies, and various body types.
 * Uses lazy initialization and optimized response building for maximum performance.
 *
 * @example
 * ```typescript
 * const response = new BunResponse();
 * response.setStatus(200);
 * response.setHeader('Content-Type', 'application/json');
 * response.cookie('sessionId', 'abc123');
 * response.end({ message: 'Success' });
 * ```
 */
export class BunResponse {
  private resolve!: (value: Response) => void
  private readonly response: Promise<Response>
  private readonly cookieMap = new CookieMap()
  private static readonly textDecoder = new TextDecoder()

  // Use Map for O(1) header operations - faster than Headers for small sets
  private headers: Map<string, string> | null = null
  private statusCode = 200
  private ended = false
  // Cache for cookie headers to avoid repeated operations
  private cookieHeaders: string[] | null = null
  // Buffer for accumulated write() calls before end()
  private chunks: (string | Uint8Array)[] = []

  constructor() {
    // Keep constructor minimal to reduce allocation overhead
    this.response = new Promise<Response>((r) => {
      this.resolve = r
    })
  }

  // Lazy headers initialization
  private get headersMap(): Map<string, string> {
    return this.headers ??= new Map()
  }

  /**
   * Sets a cookie in the response.
   * Can be called with either a cookie options object or name-value pair.
   *
   * @param options - Cookie configuration object
   * @example
   * ```typescript
   * // Using name-value pair
   * response.cookie('sessionId', 'abc123');
   *
   * // Using options object
   * response.cookie({
   *   name: 'sessionId',
   *   value: 'abc123',
   *   httpOnly: true,
   *   secure: true,
   *   maxAge: 3600
   * });
   * ```
   */
  cookie(options: CookieInit | Cookie): void
  /**
   * Sets a cookie in the response using name and value.
   *
   * @param name - The cookie name
   * @param value - The cookie value
   */
  cookie(name: string, value: string): void
  cookie(...args: unknown[]): void {
    // Invalidate cookie headers cache when cookies change
    this.cookieHeaders = null
    if (args.length === 1) {
      this.cookieMap.set(args[0] as CookieInit | Cookie)
    }
    else {
      this.cookieMap.set(
        args[0] as string,
        args[1] as string,
      )
    }
  }

  /**
   * Deletes a cookie from the response.
   *
   * @param optionsOrName - Cookie name or delete options
   * @example
   * ```typescript
   * // Delete by name
   * response.deleteCookie('sessionId');
   *
   * // Delete with options
   * response.deleteCookie({
   *   name: 'sessionId',
   *   path: '/',
   *   domain: 'example.com'
   * });
   * ```
   */
  deleteCookie(optionsOrName: CookieStoreDeleteOptions | string): void
  /**
   * Deletes a cookie from the response with additional options.
   *
   * @param optionsOrName - Cookie name
   * @param options - Additional delete options (path, domain, etc.)
   */
  deleteCookie(optionsOrName: string, options: Omit<CookieStoreDeleteOptions, 'name'>): void
  deleteCookie(optionsOrName: CookieStoreDeleteOptions | string, options?: Omit<CookieStoreDeleteOptions, 'name'>): void {
    if (typeof optionsOrName === 'string') {
      this.cookieMap.delete(optionsOrName, options as unknown as Omit<CookieStoreDeleteOptions, 'name'>)
    }
    else {
      this.cookieMap.delete(optionsOrName)
    }
  }

  /**
   * Sends a redirect response to the specified URL.
   * Ends the response after calling this method.
   *
   * @param url - The URL to redirect to
   * @param statusCode - HTTP status code for the redirect (default: 302)
   * @example
   * ```typescript
   * // Temporary redirect (302)
   * response.redirect('/login');
   *
   * // Permanent redirect (301)
   * response.redirect('/new-page', 301);
   *
   * // See Other (303)
   * response.redirect('/success', 303);
   * ```
   */
  redirect(url: string, statusCode = 302): void {
    if (this.ended) return
    this.ended = true
    this.resolve(Response.redirect(url, statusCode))
  }

  /**
   * Ends the response and sends the body to the client.
   * Automatically handles JSON serialization, streams, and binary data.
   * Can only be called once per response.
   * If write() was called before end(), accumulated chunks will be sent.
   *
   * @param body - The response body (JSON, string, Uint8Array, StreamableFile, or undefined)
   * @example
   * ```typescript
   * // Send JSON response
   * response.end({ message: 'Success', data: { id: 1 } });
   *
   * // Send empty response
   * response.setStatus(204);
   * response.end();
   *
   * // Send binary data
   * const buffer = new Uint8Array([1, 2, 3]);
   * response.end(buffer);
   *
   * // Send file stream
   * const file = new StreamableFile(stream);
   * response.end(file);
   *
   * // Send accumulated chunks from write() calls
   * response.write('Hello ');
   * response.write('World');
   * response.end('!'); // Sends "Hello World!"
   * ```
   */
  end(body?: unknown): void {
    if (this.ended) return
    this.ended = true

    // Apply cookies to headers before sending response
    this.applyCookieHeaders()

    // If there are accumulated chunks from write() calls, combine them with the final body
    if (this.chunks.length > 0) {
      const finalBody = this.combineChunks(body)
      // When chunks are combined, send as plain text/binary, not JSON
      this.resolve(this.createResponse(finalBody))
      return
    }

    this.sendResponse(body)
  }

  /**
   * Applies cookie headers to the response.
   * According to RFC 6265, each cookie must be sent as a separate Set-Cookie header.
   * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie
   */
  private applyCookieHeaders(): void {
    this.cookieHeaders ??= this.cookieMap.toSetCookieHeaders()
    if (this.cookieHeaders.length > 0) {
      // Multiple Set-Cookie headers are sent by joining with newline for HTTP/1.1 compatibility
      this.setHeader('set-cookie', this.cookieHeaders.join('\n'))
    }
  }

  private sendResponse(body?: unknown): void {
    // Fast path: check for most common case first (plain objects/arrays for JSON)
    // Avoid expensive instanceof checks when possible
    if (body !== null && typeof body === 'object') {
      // Check special types first with early returns
      if (body instanceof Uint8Array || body instanceof Blob) {
        this.resolve(this.createResponse(body))
        return
      }
      if (body instanceof StreamableFile) {
        this.resolve(this.buildStreamableResponse(body))
        return
      }
      // Default: treat as JSON-serializable object
      this.resolve(this.buildJsonResponse(body))
      return
    }

    if (!body) {
      this.resolve(this.createResponse(null))
      return
    }

    // String or primitive
    this.resolve(this.buildJsonResponse(body))
  }

  // eslint-disable-next-line sonarjs/function-return-type
  private combineChunks(finalChunk?: unknown): string | Uint8Array {
    const hasStrings = this.chunks.some(chunk => typeof chunk === 'string')
    const finalIsString = typeof finalChunk === 'string'

    // If all chunks are strings, concatenate as strings
    if (hasStrings || finalIsString) {
      return this.combineAsString(finalChunk)
    }

    // All chunks are Uint8Arrays, concatenate as binary data
    return this.combineAsBinary(finalChunk)
  }

  private combineAsString(finalChunk?: unknown): string {
    const decoder = BunResponse.textDecoder
    const parts: string[] = this.chunks.map(chunk =>
      typeof chunk === 'string' ? chunk : decoder.decode(chunk),
    )
    if (finalChunk !== undefined && finalChunk !== null) {
      if (typeof finalChunk === 'string') {
        parts.push(finalChunk)
      }
      else if (finalChunk instanceof Uint8Array) {
        parts.push(decoder.decode(finalChunk))
      }
      else if (typeof finalChunk === 'object') {
        parts.push(JSON.stringify(finalChunk))
      }
      else {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        parts.push(String(finalChunk))
      }
    }
    return parts.join('')
  }

  private combineAsBinary(finalChunk?: unknown): Uint8Array {
    const binaryChunks = this.chunks as Uint8Array[]

    // Calculate total length
    let totalLength = 0
    for (const chunk of binaryChunks) {
      totalLength += chunk.length
    }
    if (finalChunk instanceof Uint8Array) {
      totalLength += finalChunk.length
    }

    // Combine all chunks
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of binaryChunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }
    if (finalChunk instanceof Uint8Array) {
      result.set(finalChunk, offset)
    }
    return result
  }

  /**
   * Sets a response header.
   * Header names are automatically normalized to lowercase.
   *
   * @param name - The header name
   * @param value - The header value
   * @example
   * ```typescript
   * response.setHeader('Content-Type', 'application/json');
   * response.setHeader('Cache-Control', 'no-cache');
   * response.setHeader('X-Custom-Header', 'custom-value');
   * ```
   */
  setHeader(name: string, value: string): void {
    this.headersMap.set(name.toLowerCase(), value)
  }

  /**
   * Writes the response status and headers (Node.js compatibility method).
   * This method is provided for compatibility with Node.js HTTP response objects.
   *
   * @param statusCode - The HTTP status code
   * @param headers - Optional headers to set
   * @example
   * ```typescript
   * response.writeHead(200, { 'Content-Type': 'application/json' });
   * response.writeHead(404);
   * ```
   */
  writeHead(statusCode: number, headers?: Record<string, string>): void {
    this.statusCode = statusCode
    if (headers) {
      for (const [name, value] of Object.entries(headers)) {
        this.setHeader(name, value)
      }
    }
  }

  /**
   * Stub method for Node.js EventEmitter compatibility.
   * This is a no-op method provided for compatibility with Node.js HTTP response objects.
   * Some middleware may try to listen for events like 'close' on the response object.
   *
   * @param event - The event name
   * @param listener - The event listener function
   * @returns This response object for chaining
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  on(event: string, listener: (...args: unknown[]) => void): this {
    // No-op for compatibility
    return this
  }

  /**
   * Stub method for Node.js EventEmitter compatibility.
   * This is a no-op method provided for compatibility with Node.js HTTP response objects.
   *
   * @param event - The event name
   * @param listener - The event listener function
   * @returns This response object for chaining
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  off(event: string, listener: (...args: unknown[]) => void): this {
    // No-op for compatibility
    return this
  }

  /**
   * Property for Node.js HTTP response compatibility.
   * Always returns false since Bun responses don't have a destroyed state.
   */
  readonly destroyed = false

  /**
   * Stub method for Node.js HTTP response compatibility.
   * This is a no-op method provided for compatibility with Node.js HTTP response objects.
   *
   * @param error - Optional error
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  destroy(error?: Error): void {
    // No-op for compatibility
  }

  /**
   * Stub method for Node.js EventEmitter compatibility.
   * This is a no-op method provided for compatibility with Node.js HTTP response objects.
   *
   * @param event - The event name
   * @param listener - The event listener function
   * @returns This response object for chaining
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  once(event: string, listener: (...args: unknown[]) => void): this {
    // No-op for compatibility
    return this
  }

  /**
   * Stub method for Node.js HTTP response compatibility.
   * This method writes data to the response stream.
   * Data is accumulated in a buffer until end() is called.
   * Mimics Node.js behavior where write() can be called multiple times.
   *
   * @param chunk - The data to write (string, Uint8Array, or other types that can be stringified)
   * @returns true if the chunk was successfully buffered, false if the response has already ended
   * @example
   * ```typescript
   * // Write string chunks
   * response.write('Hello ');
   * response.write('World');
   * response.end('!'); // Sends "Hello World!"
   *
   * // Write binary chunks
   * const chunk1 = new Uint8Array([1, 2, 3]);
   * const chunk2 = new Uint8Array([4, 5, 6]);
   * response.write(chunk1);
   * response.write(chunk2);
   * response.end(); // Sends combined binary data
   *
   * // Mixed usage (converts to string)
   * response.write('Status: ');
   * response.write(200);
   * response.end(); // Sends "Status: 200"
   * ```
   */
  write(chunk: unknown): boolean {
    // Node.js behavior: writing after end() should be ignored and return false
    if (this.ended) {
      return false
    }

    // Handle string chunks
    if (typeof chunk === 'string') {
      this.chunks.push(chunk)
      return true
    }

    // Handle binary chunks
    if (chunk instanceof Uint8Array) {
      this.chunks.push(chunk)
      return true
    }

    // Handle Buffer (which is a Uint8Array subclass in Node.js)
    if (chunk instanceof Buffer) {
      this.chunks.push(new Uint8Array(chunk))
      return true
    }

    // For other types, convert to string (Node.js behavior)
    if (chunk != null) {
      if (typeof chunk === 'object') {
        this.chunks.push(JSON.stringify(chunk))
      }
      else {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        this.chunks.push(String(chunk))
      }
      return true
    }

    // Empty chunk is valid, just return true
    return true
  }

  /**
   * Gets the value of a response header.
   * Header lookup is case-insensitive.
   *
   * @param name - The header name to retrieve
   * @returns The header value or null if not set
   * @example
   * ```typescript
   * response.setHeader('Content-Type', 'application/json');
   * const contentType = response.getHeader('content-type');
   * console.log(contentType); // "application/json"
   *
   * const missing = response.getHeader('X-Missing');
   * console.log(missing); // null
   * ```
   */
  getHeader(name: string): string | null {
    return this.headers?.get(name.toLowerCase()) ?? null
  }

  /**
   * Appends a value to an existing response header.
   * If the header doesn't exist, it will be created.
   * Multiple values are joined with a comma as per RFC 9110.
   *
   * @param name - The header name
   * @param value - The value to append
   * @example
   * ```typescript
   * response.setHeader('Cache-Control', 'no-cache');
   * response.appendHeader('Cache-Control', 'no-store');
   * // Results in: "Cache-Control: no-cache, no-store"
   *
   * response.appendHeader('X-Custom', 'value1');
   * response.appendHeader('X-Custom', 'value2');
   * // Results in: "X-Custom: value1, value2"
   * ```
   */
  appendHeader(name: string, value: string): void {
    const key = name.toLowerCase()
    const headers = this.headersMap
    const existing = headers.get(key)
    /**
     * According to RFC 9110, multiple header values should be concatenated with a comma.
     * @see https://datatracker.ietf.org/doc/html/rfc9110#section-5.3.3
     */
    headers.set(key, existing ? `${existing}, ${value}` : value)
  }

  /**
   * Removes a response header.
   * Header lookup is case-insensitive.
   *
   * @param name - The header name to remove
   * @example
   * ```typescript
   * response.setHeader('X-Custom-Header', 'value');
   * response.removeHeader('X-Custom-Header');
   *
   * const header = response.getHeader('X-Custom-Header');
   * console.log(header); // null
   * ```
   */
  removeHeader(name: string): void {
    this.headers?.delete(name.toLowerCase())
  }

  /**
   * Sets the HTTP status code for the response.
   *
   * @param code - The HTTP status code (e.g., 200, 404, 500)
   * @example
   * ```typescript
   * response.setStatus(200); // OK
   * response.setStatus(201); // Created
   * response.setStatus(400); // Bad Request
   * response.setStatus(404); // Not Found
   * response.setStatus(500); // Internal Server Error
   * ```
   */
  setStatus(code: number): void {
    this.statusCode = code
  }

  /**
   * Gets the current HTTP status code of the response.
   *
   * @returns The HTTP status code
   * @example
   * ```typescript
   * response.setStatus(404);
   * const status = response.getStatus();
   * console.log(status); // 404
   * ```
   */
  getStatus(): number {
    return this.statusCode
  }

  /**
   * Returns a Promise that resolves to the native Response object.
   * The Promise resolves when end() or redirect() is called.
   *
   * @returns Promise that resolves to the Bun Response object
   * @example
   * ```typescript
   * const response = new BunResponse();
   * response.setStatus(200);
   * response.end({ message: 'Success' });
   *
   * const nativeResponse = await response.res();
   * console.log(nativeResponse.status); // 200
   * ```
   */
  res(): Promise<Response> {
    return this.response
  }

  /**
   * Checks if the response has been ended.
   * Once ended, no further modifications can be made to the response.
   *
   * @returns true if the response has been ended, false otherwise
   * @example
   * ```typescript
   * const response = new BunResponse();
   * console.log(response.isEnded()); // false
   *
   * response.end({ message: 'Done' });
   * console.log(response.isEnded()); // true
   *
   * // This will be ignored since response is already ended
   * response.setHeader('X-Custom', 'value');
   * ```
   */
  isEnded(): boolean {
    return this.ended
  }

  private buildStreamableResponse(body: StreamableFile): Response {
    const streamHeaders = body.getHeaders()
    const headers = this.headersMap
    if (streamHeaders.type && !headers.has('content-type')) {
      headers.set('content-type', streamHeaders.type)
    }
    if (streamHeaders.disposition && !headers.has('content-disposition')) {
      headers.set('content-disposition', streamHeaders.disposition as string)
    }
    if (streamHeaders.length !== undefined && !headers.has('content-length')) {
      headers.set('content-length', String(streamHeaders.length))
    }
    return this.createResponse(body.getStream())
  }

  private buildJsonResponse(body: unknown): Response {
    const headers = this.headers
    // Hot path: no headers
    if (headers === null || headers.size === 0) {
      return Response.json(body, { status: this.statusCode })
    }
    // Set content-type only if not already set
    if (!headers.has('content-type')) {
      headers.set('content-type', JSON_CONTENT_TYPE)
    }
    return Response.json(body, {
      status: this.statusCode,
      headers: Object.fromEntries(headers),
    })
  }

  private createResponse(body: BodyInit | null): Response {
    const headers = this.headers
    if (headers === null || headers.size === 0) {
      return new Response(body, { status: this.statusCode })
    }
    return new Response(body, {
      status: this.statusCode,
      headers: Object.fromEntries(headers),
    })
  }
}
