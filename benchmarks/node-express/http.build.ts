await Bun.build({
  entrypoints: ['benchmarks/node-express/index.ts'],
  outdir: 'benchmarks/node-express/dist',
  naming: 'index.cjs',
  target: 'node',
  packages: 'bundle',
  format: 'cjs',
  external: [
    '@nestjs/common',
    '@nestjs/core',
  ],
})
