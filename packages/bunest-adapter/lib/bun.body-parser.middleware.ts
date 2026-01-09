import { BunRequest } from './bun.request.js'
import { BunResponse } from './bun.response.js'

// Pre-computed method codes for fast comparison
const GET_CODE = 'GET'.charCodeAt(0) // 71
const HEAD_CODE = 'HEAD'.charCodeAt(0) // 72
const DELETE_CODE = 'DELETE'.charCodeAt(0) // 68
const OPTIONS_CODE = 'OPTIONS'.charCodeAt(0) // 79

export class BunBodyParserMiddleware {
  private readonly prefix: string | null
  private readonly rawBody: boolean
  private readonly prefixLen: number
  private readonly skippedPaths = new Set<string>()

  constructor(options?: { prefix?: string, rawBody?: boolean }) {
    this.prefix = options?.prefix ?? null
    this.prefixLen = this.prefix?.length ?? 0
    this.rawBody = options?.rawBody ?? false
  }

  skip(path: string): void {
    this.skippedPaths.add(path)
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  async run(req: BunRequest, res: BunResponse, next?: Function): Promise<void> {
    // Fast path: skip body parsing for methods that don't have body
    // Use charCodeAt for fast string comparison
    const pathname = req.pathname
    const methodFirstChar = req.method.charCodeAt(0)
    if (
      methodFirstChar === GET_CODE // Most common case first
      || methodFirstChar === HEAD_CODE
      || methodFirstChar === DELETE_CODE
      || methodFirstChar === OPTIONS_CODE
      || this.skippedPaths.has(pathname)
    ) {
      next?.()
      return
    }

    // Check prefix if specified
    if (this.prefix !== null) {
      if (pathname.length < this.prefixLen || !pathname.startsWith(this.prefix)) {
        next?.()
        return
      }
    }

    if (this.rawBody) {
      req.setRawBody(await req.arrayBuffer())
    }

    await this.parseRequestBody(req)
    next?.()
  }

  private async parseRequestBody(req: BunRequest): Promise<void> {
    const contentType = req.headers.get('content-type')
    if (!contentType) {
      return
    }

    // Use indexOf for faster content-type checking
    if (contentType.includes('application/json')) {
      req.setBody(await req.json())
      return
    }

    if (contentType.includes('text/') || contentType.includes('application/text')) {
      req.setBody(await req.text())
      return
    }

    if (contentType.includes('form')) {
      await this.parseFormData(req)
    }
  }

  private async parseFormData(req: BunRequest): Promise<void> {
    const formData = await req.formData()
    const body: Record<string, string | File> = Object.create(null) as Record<string, string | File>
    let files: File[] | null = null
    let firstFile: File | null = null

    for (const [key, value] of formData.entries()) {
      body[key] = value
      // Fast file detection using 'size' property check
      if (this.isFile(value)) {
        if (firstFile === null) {
          firstFile = value
          files = [value]
        }
        else {
          files?.push(value)
        }
      }
    }

    req.setBody(body)

    if (firstFile !== null) {
      req.setFile(firstFile)
    }

    if (files !== null) {
      req.setFiles(files)
    }
  }

  private isFile(value: unknown): value is File {
    return typeof value === 'object' && value !== null && 'size' in value && 'name' in value && 'type' in value
  }
}
