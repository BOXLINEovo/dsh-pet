import { defineConfig } from 'tsdown'

// Minimal two-half build:
//  - src/index.ts        -> lib/index.js   (node half: balance route)
//  - src/client/index.ts -> lib/client.js  (browser half: pet UI, ModuleLoader-wrapped)
export default defineConfig([
  {
    name: 'dsh-pet',
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    name: 'dsh-pet/client',
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: false,
    clean: false,
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "@dsh-external/dsh-client-pet-deepwhale", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
