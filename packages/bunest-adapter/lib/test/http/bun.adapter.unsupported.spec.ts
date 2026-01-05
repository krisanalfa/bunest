import { describe, expect, it } from 'bun:test'

import { BunAdapter } from '../../bun.adapter.js'
import { BunRequest } from '../../bun.request.js'
import { BunResponse } from '../../bun.response.js'

describe('BunAdapter Unsupported Methods', () => {
  const adapter = new BunAdapter()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const dummyHandler = (_req: BunRequest, _res: BunResponse) => {
    // No-op handler for testing
  }

  describe('HTTP Methods', () => {
    it('should throw error for all() method', () => {
      expect(() => {
        adapter.all(dummyHandler)
      }).toThrow('Not supported.')
      expect(() => {
        adapter.all('/path', dummyHandler)
      }).toThrow('Not supported.')
    })

    it('should throw error for propfind() method', () => {
      expect(() => {
        adapter.propfind(dummyHandler)
      }).toThrow('Not supported.')
      expect(() => {
        adapter.propfind('/path', dummyHandler)
      }).toThrow('Not supported.')
    })

    it('should throw error for proppatch() method', () => {
      expect(() => {
        adapter.proppatch(dummyHandler)
      }).toThrow('Not supported.')
      expect(() => {
        adapter.proppatch('/path', dummyHandler)
      }).toThrow('Not supported.')
    })

    it('should throw error for mkcol() method', () => {
      expect(() => {
        adapter.mkcol(dummyHandler)
      }).toThrow('Not supported.')
      expect(() => {
        adapter.mkcol('/path', dummyHandler)
      }).toThrow('Not supported.')
    })

    it('should throw error for copy() method', () => {
      expect(() => {
        adapter.copy(dummyHandler)
      }).toThrow('Not supported.')
      expect(() => {
        adapter.copy('/path', dummyHandler)
      }).toThrow('Not supported.')
    })

    it('should throw error for move() method', () => {
      expect(() => {
        adapter.move(dummyHandler)
      }).toThrow('Not supported.')
      expect(() => {
        adapter.move('/path', dummyHandler)
      }).toThrow('Not supported.')
    })

    it('should throw error for lock() method', () => {
      expect(() => {
        adapter.lock(dummyHandler)
      }).toThrow('Not supported.')
      expect(() => {
        adapter.lock('/path', dummyHandler)
      }).toThrow('Not supported.')
    })

    it('should throw error for unlock() method', () => {
      expect(() => {
        adapter.unlock(dummyHandler)
      }).toThrow('Not supported.')
      expect(() => {
        adapter.unlock('/path', dummyHandler)
      }).toThrow('Not supported.')
    })

    it('should throw error for search() method', () => {
      expect(() => {
        adapter.search(dummyHandler)
      }).toThrow('Not supported.')
      expect(() => {
        adapter.search('/path', dummyHandler)
      }).toThrow('Not supported.')
    })
  })

  describe('Static Assets and Templating', () => {
    it('should throw error for setViewEngine()', () => {
      expect(() => {
        adapter.setViewEngine('ejs')
      }).toThrow('Not supported.')
      expect(() => {
        adapter.setViewEngine('pug')
      }).toThrow('Not supported.')
      expect(() => {
        adapter.setViewEngine('hbs')
      }).toThrow('Not supported.')
    })

    it('should throw error for render()', () => {
      const mockResponse = {}
      expect(() => {
        adapter.render(mockResponse, 'template', {})
      }).toThrow('Not supported.')
      expect(() => {
        adapter.render(mockResponse, 'index', { title: 'Test' })
      }).toThrow('Not supported.')
    })
  })
})
