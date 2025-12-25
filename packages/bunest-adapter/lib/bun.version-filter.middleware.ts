import {
  CustomVersioningOptions,
  HeaderVersioningOptions,
  MediaTypeVersioningOptions,
  VersionValue,
} from '@nestjs/common/interfaces/version-options.interface.js'
import { VERSION_NEUTRAL, VersioningOptions, VersioningType } from '@nestjs/common'

import { BunRequest } from './bun.request.js'
import { BunResponse } from './bun.response.js'

type VersionHandler = (req: BunRequest, res: BunResponse, next: () => void) => unknown

/**
 * Metadata attached to request for custom versioning two-pass execution
 */
export interface CustomVersioningMeta {
  _customVersioningPhase?: 'discovery' | 'execution'
  _customVersioningCandidates?: Map<string, { priority: number, execute: () => unknown }>
  _customVersioningBestCandidate?: string
}

/** Helper to execute handler and await if needed */
async function executeHandler(handler: VersionHandler, req: BunRequest, res: BunResponse, next: () => void): Promise<unknown> {
  const result = handler(req, res, next)
  return result instanceof Promise ? await result : result
}

/** Helper to call next and await if needed */
function callNext(next: () => void | Promise<void>): void | Promise<void> {
  return next()
}

/**
 * Middleware for handling NestJS versioning in BunAdapter.
 * Supports URI, Header, Media Type, and Custom versioning strategies.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class BunVersionFilterMiddleware {
  /**
   * Creates a version-filtered handler wrapper.
   */
  static createFilter(
    handler: VersionHandler,
    version: VersionValue,
    versioningOptions: VersioningOptions,
  ): VersionHandler {
    if (version === VERSION_NEUTRAL || versioningOptions.type === VersioningType.URI) {
      return handler
    }

    // Use switch instead of object creation for better performance
    switch (versioningOptions.type) {
      case VersioningType.CUSTOM:
        return this.createCustomVersionFilter(handler, version, versioningOptions as CustomVersioningOptions)
      case VersioningType.MEDIA_TYPE:
        return this.createMediaTypeVersionFilter(handler, version, versioningOptions as MediaTypeVersioningOptions)
      case VersioningType.HEADER:
        return this.createHeaderVersionFilter(handler, version, versioningOptions as HeaderVersioningOptions)
      default:
        throw new Error('Unsupported versioning options')
    }
  }

  /** Checks if the handler version matches the requested version (optimized with Set for arrays) */
  private static createVersionMatcher(handlerVersion: VersionValue): (requestedVersion: string | undefined) => boolean {
    if (Array.isArray(handlerVersion)) {
      const versionSet = new Set(handlerVersion)
      return requestedVersion => requestedVersion !== undefined && versionSet.has(requestedVersion)
    }
    return requestedVersion => requestedVersion == handlerVersion
  }

  /** Pre-computes whether handler accepts VERSION_NEUTRAL */
  private static computeAcceptsNeutral(version: VersionValue): boolean {
    return version === VERSION_NEUTRAL
      || (Array.isArray(version) && version.includes(VERSION_NEUTRAL))
  }

  /** Extracts header value from request - optimized to use .get() directly */
  private static getHeader(req: BunRequest, name: string): string | undefined {
    // Headers.get() is case-insensitive per spec, so we only need one call
    return req.headers.get(name) ?? undefined
  }

  /** Creates a filter for Custom versioning (uses extractor function) */
  private static createCustomVersionFilter(
    handler: VersionHandler,
    version: VersionValue,
    options: CustomVersioningOptions,
  ): VersionHandler {
    // Pre-compute version set for O(1) lookups
    const isVersionArray = Array.isArray(version)
    const versionSet = isVersionArray ? new Set(version as string[]) : null
    const singleVersion = isVersionArray ? null : version as string

    return async (req, res, next) => {
      const extracted = options.extractor(req)
      const reqMeta = req as CustomVersioningMeta

      // Initialize metadata on first handler
      reqMeta._customVersioningPhase ??= 'discovery'
      reqMeta._customVersioningCandidates ??= new Map()

      const isDiscovery = reqMeta._customVersioningPhase === 'discovery'

      // Inline findVersionMatch for performance
      const extractedIsArray = Array.isArray(extracted)
      const extractedVersions = extractedIsArray ? extracted : [extracted]
      let match: string | undefined
      let matchIndex = -1

      for (let i = 0; i < extractedVersions.length; i++) {
        const extractedVersion = extractedVersions[i]
        if (versionSet ? versionSet.has(extractedVersion) : extractedVersion === singleVersion) {
          match = extractedVersion
          matchIndex = i
          break
        }
      }

      if (match) {
        if (isDiscovery) {
          reqMeta._customVersioningCandidates.set(match, {
            priority: matchIndex,
            execute: () => handler(req, res, next),
          })
          return callNext(next)
        }

        if (reqMeta._customVersioningBestCandidate === match) {
          return executeHandler(handler, req, res, next)
        }
      }

      return callNext(next)
    }
  }

  /** Creates a filter for Media Type (Accept header) versioning */
  private static createMediaTypeVersionFilter(
    handler: VersionHandler,
    version: VersionValue,
    options: MediaTypeVersioningOptions,
  ): VersionHandler {
    // Pre-compute at filter creation time
    const acceptsNeutral = this.computeAcceptsNeutral(version)
    const versionMatches = this.createVersionMatcher(version)
    const keyLength = options.key.length

    return async (req, res, next) => {
      const acceptHeader = this.getHeader(req, 'accept')

      if (acceptHeader) {
        // Find semicolon position without creating intermediate array
        const semiIndex = acceptHeader.indexOf(';')
        if (semiIndex !== -1) {
          const versionPart = acceptHeader.substring(semiIndex + 1).trim()
          // Find the key and extract version after it
          const keyIndex = versionPart.indexOf(options.key)
          if (keyIndex !== -1) {
            const headerVersion = versionPart.substring(keyIndex + keyLength)
            if (versionMatches(headerVersion)) {
              return executeHandler(handler, req, res, next)
            }
            return callNext(next)
          }
        }
      }

      // No version param found
      if (acceptsNeutral) {
        return executeHandler(handler, req, res, next)
      }
      return callNext(next)
    }
  }

  /** Creates a filter for Header versioning (custom header) */
  private static createHeaderVersionFilter(
    handler: VersionHandler,
    version: VersionValue,
    options: HeaderVersioningOptions & { defaultVersion?: VersionValue },
  ): VersionHandler {
    // Pre-compute at filter creation time
    const acceptsNeutral = this.computeAcceptsNeutral(version)
    const versionMatches = this.createVersionMatcher(version)
    const defaultVersion = options.defaultVersion
    const hasNeutralDefault = defaultVersion === VERSION_NEUTRAL
    const resolvedDefault = this.resolveDefaultVersion(version, defaultVersion)
    const headerName = options.header

    return async (req, res, next) => {
      let headerVersion: string | undefined = this.getHeader(req, headerName)?.trim()

      // Treat empty or whitespace-only as undefined
      if (headerVersion === '') headerVersion = undefined

      // Apply default version if no header provided
      headerVersion ??= resolvedDefault

      // No version provided
      if (!headerVersion) {
        // Handle VERSION_NEUTRAL default or neutral-accepting handler
        if ((hasNeutralDefault || !defaultVersion) && acceptsNeutral) {
          return executeHandler(handler, req, res, next)
        }
        return callNext(next)
      }

      if (versionMatches(headerVersion)) {
        return executeHandler(handler, req, res, next)
      }
      return callNext(next)
    }
  }

  /** Resolves default version that matches handler version */
  private static resolveDefaultVersion(
    handlerVersion: VersionValue,
    defaultVersion: VersionValue | undefined,
  ): string | undefined {
    if (defaultVersion === undefined || defaultVersion === VERSION_NEUTRAL) {
      return undefined
    }

    const handlerVersions = Array.isArray(handlerVersion) ? handlerVersion : [handlerVersion]

    if (typeof defaultVersion === 'string') {
      return handlerVersions.includes(defaultVersion) ? defaultVersion : undefined
    }

    if (Array.isArray(defaultVersion)) {
      return defaultVersion.find(dv => typeof dv === 'string' && handlerVersions.includes(dv)) as string | undefined
    }

    return undefined
  }

  /** Selects the best custom versioning candidate after discovery phase */
  static selectBestCustomVersionCandidate(req: BunRequest): string | null {
    const { _customVersioningPhase: phase, _customVersioningCandidates: candidates } = req as CustomVersioningMeta

    if (phase !== 'discovery' || !candidates?.size) return null

    let bestVersion: string | null = null
    let bestPriority = Infinity

    for (const [version, { priority }] of candidates) {
      if (priority < bestPriority) {
        bestPriority = priority
        bestVersion = version
      }
    }

    return bestVersion
  }

  /** Switches the request to execution phase for custom versioning */
  static setCustomVersioningExecutionPhase(req: BunRequest, bestVersion: string): void {
    const reqMeta = req as CustomVersioningMeta
    reqMeta._customVersioningPhase = 'execution'
    reqMeta._customVersioningBestCandidate = bestVersion
  }

  /** Checks if request has custom versioning candidates pending */
  static hasCustomVersioningCandidates(req: BunRequest): boolean {
    const { _customVersioningPhase: phase, _customVersioningCandidates: candidates } = req as CustomVersioningMeta
    return phase === 'discovery' && !!candidates?.size
  }
}
