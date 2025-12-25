import { rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

await rm('dist', { recursive: true, force: true })

// Build JavaScript
await Bun.build({
  entrypoints: ['lib/index.ts'],
  outdir: 'dist',
  target: 'bun',
  format: 'esm',
  minify: false,
  sourcemap: true,
  packages: 'external',
  external: [
    '@nestjs/common',
    '@nestjs/core',
  ],
})

// Generate TypeScript declarations
const tscResult = Bun.spawnSync([
  'bunx',
  'tsc',
  '--project',
  'tsconfig.json',
  '--declaration',
  '--emitDeclarationOnly',
  '--outDir',
  'dist',
], {
  stdout: 'inherit',
  stderr: 'inherit',
})

if (!tscResult.success) {
  console.error('TypeScript declaration generation failed')
  process.exit(1)
}

// Move wanted declaration files from dist/lib to dist and clean up
const keepFiles = [
  'index.d.ts',
  'bun.adapter.d.ts',
  'bun.request.d.ts',
  'bun.response.d.ts',
  'bun.file.interceptor.d.ts',
]

const libDir = join('dist', 'lib')
for (const file of keepFiles) {
  await rename(join(libDir, file), join('dist', file))
}

// Remove the lib directory with all remaining files
await rm(libDir, { recursive: true, force: true })
