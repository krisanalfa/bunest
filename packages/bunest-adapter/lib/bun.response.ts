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

  // Use Map for O(1) header operations - faster than Headers for small sets
  private _headers: Map<string, string> | null = null
  private statusCode = 200
  private ended = false
  // Cache for cookie headers to avoid repeated string operations
  private _cookieHeaderCache: string | null = null

  constructor() {
    // Keep constructor minimal to reduce allocation overhead
    this.response = new Promise<Response>((r) => {
      this.resolve = r
    })
  }

  // Lazy headers initialization
  private get headersMap(): Map<string, string> {
    return this._headers ??= new Map()
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
    // Invalidate cookie header cache when cookies change
    this._cookieHeaderCache = null
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
   * ```
   */
  end(body?: unknown): void {
    if (this.ended) return
    this.ended = true
    /**
     * According to RFC 6265, multiple Set-Cookie attributes should be separated by semicolons.
     * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie#syntax
     * @see https://bun.com/docs/runtime/cookies#tosetcookieheaders-:-string[]
     */
    this._cookieHeaderCache ??= this.cookieMap.toSetCookieHeaders().join('; ')
    if (this._cookieHeaderCache.length > 0) {
      this.setHeader('set-cookie', this._cookieHeaderCache)
    }

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
    return this._headers?.get(name.toLowerCase()) ?? null
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
    this._headers?.delete(name.toLowerCase())
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
    const headers = this._headers
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
    const headers = this._headers
    if (headers === null || headers.size === 0) {
      return new Response(body, { status: this.statusCode })
    }
    return new Response(body, {
      status: this.statusCode,
      headers: Object.fromEntries(headers),
    })
  }
}
