### 0.0.1

- Initial release of @krisanalfa/bunest-adapter package.

### 0.1.0

- Better support for other popular express.js middlewares like "better-auth" via `@thallesp/nestjs-better-auth`

> p.s.: 0.2.0 version was skipped due to too many ~~beers~~ breaking changes.

### 0.3.0

- Support WebSocket

### 0.4.0

- Massive refactor to improve performance and code maintainability.
  - Introduced `BunServerInstance` to encapsulate Bun server logic while keeping the adapter clean.
- Support Server-Sent Events (SSE) (highly experimental, use with caution).

### 0.5.0
- Chores done
  - Introduced `NestBunApplication` for better type safety and clarity.
- Support static assets.
- Added `express-session` middleware support (experimental, use with caution).
