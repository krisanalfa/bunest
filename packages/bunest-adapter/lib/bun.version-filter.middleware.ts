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

/** Key constants for custom versioning metadata stored in request settings */
const CUSTOM_VERSIONING_PHASE_KEY = '_cvp'
const CUSTOM_VERSIONING_CANDIDATES_KEY = '_cvc'
const CUSTOM_VERSIONING_BEST_CANDIDATE_KEY = '_cvb'

/** Type for custom versioning phase: 0 = discovery, 1 = execution */
type CustomVersioningPhase = 0 | 1

/** Type for custom versioning candidates map - stores only priority now */
type CustomVersioningCandidates = Map<string, number>

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

    return (req, res, next) => {
      const extracted = options.extractor(req)

      // Initialize metadata on first handler using get/set
      // Phase: 0 = discovery, 1 = execution
      let phase = req.get<CustomVersioningPhase>(CUSTOM_VERSIONING_PHASE_KEY)
      if (phase === undefined) {
        phase = 0
        req.set(CUSTOM_VERSIONING_PHASE_KEY, phase)
      }

      let candidates = req.get<CustomVersioningCandidates>(CUSTOM_VERSIONING_CANDIDATES_KEY)
      if (!candidates) {
        candidates = new Map()
        req.set(CUSTOM_VERSIONING_CANDIDATES_KEY, candidates)
      }

      // Inline findVersionMatch for performance
      const extractedVersions = Array.isArray(extracted) ? extracted : [extracted]
      let match: string | undefined
      let matchIndex = -1

      for (let i = 0, len = extractedVersions.length; i < len; i++) {
        const extractedVersion = extractedVersions[i]
        if (versionSet ? versionSet.has(extractedVersion) : extractedVersion === singleVersion) {
          match = extractedVersion
          matchIndex = i
          break
        }
      }

      if (match) {
        // Discovery phase (0)
        if (phase === 0) {
          // Only store priority, not the execute closure
          candidates.set(match, matchIndex)
          next()
          return
        }

        // Execution phase (1) - check if this is the best candidate
        if (req.get<string>(CUSTOM_VERSIONING_BEST_CANDIDATE_KEY) === match) {
          return handler(req, res, next)
        }
      }

      next()
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
    const key = options.key
    const keyLength = key.length

    return (req, res, next) => {
      const acceptHeader = req.headers.get('accept')

      if (acceptHeader) {
        // Find semicolon position without creating intermediate array
        const semiIndex = acceptHeader.indexOf(';')
        if (semiIndex !== -1) {
          const versionPart = acceptHeader.substring(semiIndex + 1).trim()
          // Find the key and extract version after it
          const keyIndex = versionPart.indexOf(key)
          if (keyIndex !== -1) {
            const headerVersion = versionPart.substring(keyIndex + keyLength)
            if (versionMatches(headerVersion)) {
              return handler(req, res, next)
            }
            next()
            return
          }
        }
      }

      // No version param found
      if (acceptsNeutral) {
        return handler(req, res, next)
      }
      next()
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

    return (req, res, next) => {
      let headerVersion: string | undefined = req.headers.get(headerName) ?? undefined

      // Trim and treat empty as undefined
      if (headerVersion) {
        headerVersion = headerVersion.trim()
        if (headerVersion === '') headerVersion = undefined
      }

      // Apply default version if no header provided
      headerVersion ??= resolvedDefault

      // No version provided
      if (!headerVersion) {
        // Handle VERSION_NEUTRAL default or neutral-accepting handler
        if ((hasNeutralDefault || !defaultVersion) && acceptsNeutral) {
          return handler(req, res, next)
        }
        next()
        return
      }

      if (versionMatches(headerVersion)) {
        return handler(req, res, next)
      }
      next()
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

  /** Selects the best custom versioning candidate after discovery phase - returns null if not in discovery or no candidates */
  static selectBestCustomVersionCandidate(req: BunRequest): string | null {
    // Phase: 0 = discovery, 1 = execution, undefined = not custom versioning
    const phase = req.get<CustomVersioningPhase>(CUSTOM_VERSIONING_PHASE_KEY)
    if (phase !== 0) return null

    const candidates = req.get<CustomVersioningCandidates>(CUSTOM_VERSIONING_CANDIDATES_KEY)
    if (!candidates?.size) return null

    let bestVersion: string | null = null
    let bestPriority = Infinity

    for (const [version, priority] of candidates) {
      if (priority < bestPriority) {
        bestPriority = priority
        bestVersion = version
      }
    }

    return bestVersion
  }

  /** Switches the request to execution phase for custom versioning */
  static setCustomVersioningExecutionPhase(req: BunRequest, bestVersion: string): void {
    req.set(CUSTOM_VERSIONING_PHASE_KEY, 1 as CustomVersioningPhase)
    req.set(CUSTOM_VERSIONING_BEST_CANDIDATE_KEY, bestVersion)
  }

  /** Checks if request has custom versioning candidates pending (combined check) */
  static hasCustomVersioningCandidates(req: BunRequest): boolean {
    // Phase: 0 = discovery - only check phase first (fast path)
    const phase = req.get<CustomVersioningPhase>(CUSTOM_VERSIONING_PHASE_KEY)
    if (phase !== 0) return false
    const candidates = req.get<CustomVersioningCandidates>(CUSTOM_VERSIONING_CANDIDATES_KEY)
    return !!candidates?.size
  }
}
