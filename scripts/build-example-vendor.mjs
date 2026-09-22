import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

/**
 * Bundle the framework the React example page imports.
 *
 * examples/vue resolves `vue` straight out of node_modules through an import
 * map, because Vue ships a browser ESM build. React ships none — `react` and
 * `react-dom/client` are CommonJS — so the same trick needs one bundling step,
 * and this is it. Before this the page pulled both from esm.sh, which meant it
 * could not load where CI has no network (so no browser test ever drove it) and
 * ran React 18 while the adapter is tested against the installed 19.
 *
 * Both specifiers are bundled into a SINGLE module, which the import map then
 * points at twice. Two vendor files would give the page two copies of React, and
 * react-dom's reconciler would then differ from the `react` the component
 * imports — every hook call fails with "Invalid hook call".
 */
const outfile = fileURLToPath(new URL('../examples/react/vendor/react.esm.js', import.meta.url));

/** The names examples/react/main.jsx imports, re-exported one by one.
 *
 * `export * from 'react'` compiles but yields NOTHING: `react/index.js` is
 * `module.exports = require('./cjs/react.development.js')`, and an export-star
 * over a CJS module whose shape is a runtime reassignment has no static names to
 * forward. Verified, not inferred — the bundle that used `export *` exported
 * `createRoot` (react-dom/client does assign its properties) and left every
 * `react` hook `undefined`. So the list is explicit, and a page that starts
 * importing another name has to add it here; the browser then says so out loud
 * ("does not provide an export named …") rather than silently. */
const REACT_EXPORTS = [
  'Children',
  'Component',
  'Fragment',
  'PureComponent',
  'StrictMode',
  'cloneElement',
  'createContext',
  'createElement',
  'createRef',
  'forwardRef',
  'isValidElement',
  'lazy',
  'memo',
  'useCallback',
  'useContext',
  'useDebugValue',
  'useDeferredValue',
  'useEffect',
  'useId',
  'useImperativeHandle',
  'useInsertionEffect',
  'useLayoutEffect',
  'useMemo',
  'useReducer',
  'useRef',
  'useState',
  'useSyncExternalStore',
  'useTransition',
  'version'
];

await build({
  stdin: {
    contents: [
      "import * as ReactNamespaced from 'react';",
      ...REACT_EXPORTS.map(name => `export const ${name} = ReactNamespaced[${JSON.stringify(name)}] ?? ReactNamespaced.default?.[${JSON.stringify(name)}];`),
      "export { createRoot, hydrateRoot } from 'react-dom/client';"
    ].join('\n'),
    // Resolve `react` / `react-dom` from the repository root, where pnpm has
    // linked the devDependencies the example mirrors.
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    sourcefile: 'react-vendor.js',
    loader: 'js'
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile,
  sourcemap: true,
  // The development build, matching what examples/vue serves (`vue.esm-browser.js`
  // rather than the `.prod` file): an example page should surface the framework's
  // own warnings instead of hiding them.
  define: { 'process.env.NODE_ENV': '"development"' },
  target: ['es2022']
});

console.log(`[examples] bundled react + react-dom/client -> examples/react/vendor/react.esm.js`);
