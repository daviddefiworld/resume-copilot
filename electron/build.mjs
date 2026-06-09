import { build } from 'esbuild';

// The Electron main process is bundled to CommonJS: Electron's runtime patches
// the CJS `require('electron')` to return the real module, whereas an ESM main
// entry only sees `default`/`module.exports` (named imports like `app` and
// `BrowserWindow` are absent) and crashes at instantiation.
//
// CJS has no `import.meta`, so we map every `import.meta.url` to the bundle's
// own file URL via a banner-defined constant. After bundling everything lands
// in dist-electron/main.cjs, so `fileURLToPath(import.meta.url)` correctly
// resolves to that directory — exactly what main.ts wants for the client dir.
await build({
  entryPoints: ['electron/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'dist-electron/main.cjs',
  // `electron` is injected by the runtime. `pdfkit` reads its standard-font
  // `.afm` metric files from `__dirname/data` at runtime — bundling it would
  // rewrite that path to dist-electron, where the data files don't exist. Keep
  // it external so it loads from node_modules (shipped in the asar, unpacked)
  // with its data/ folder beside it.
  external: ['electron', 'pdfkit'],
  define: { 'import.meta.url': '__bundleMetaUrl' },
  banner: { js: "const __bundleMetaUrl = require('url').pathToFileURL(__filename).href;" },
});
