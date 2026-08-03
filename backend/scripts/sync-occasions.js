/**
 * Generates `backend/data/occasions.json` from the app's celebration catalogue.
 *
 *   node scripts/sync-occasions.js
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * The catalogue is authored once, in `frontend/src/celebrations/occasions.js`,
 * where each occasion's dates sit next to its palette, scene and emblem. That
 * is the right place for a human to edit it.
 *
 * The server needs a slice of the same data — key, name, wish and date rule —
 * to decide who gets a morning wish on Diwali. It must NOT reach into the
 * frontend at runtime: the backend is deployed on its own, and a missing sibling
 * directory would take the notification job down. So the slice is generated
 * here and committed as a plain JSON artifact the server just requires.
 *
 * ── Why it looks like this ───────────────────────────────────────────────
 * The catalogue is written in ES module syntax for the app bundler, and this
 * script runs in plain CommonJS Node. Rather than add a build tool, restructure
 * the catalogue around the server's convenience, or add `"type": "module"` to
 * the frontend (which would break babel.config.js), the loader below does a
 * deliberately small ESM→CJS rewrite: named imports, named exports, re-exports.
 * That is the entire surface those four files use.
 *
 * It is narrow on purpose, and it fails loudly. This runs at authoring time,
 * never in production — if the catalogue ever grows syntax the loader doesn't
 * handle, this script throws here rather than shipping something wrong.
 *
 * Re-run it whenever you add an occasion or top up the lunar table, and commit
 * the regenerated JSON alongside.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FRONTEND_SRC = path.resolve(__dirname, '../../frontend/src');
const ENTRY = path.join(FRONTEND_SRC, 'celebrations/occasions.js');
const OUT = path.resolve(__dirname, '../data/occasions.json');

/** Resolve a relative specifier to an absolute .js path. */
function resolveSpec(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`sync-occasions: cannot resolve "${spec}" from ${fromFile}`);
}

const cache = new Map();

function loadModule(absPath) {
  if (cache.has(absPath)) return cache.get(absPath);

  const exportsObj = {};
  // Seed the cache before evaluating so a cycle resolves to a partial object
  // rather than recursing forever.
  cache.set(absPath, exportsObj);

  let src = fs.readFileSync(absPath, 'utf8');
  const exportedNames = new Set();

  // `export { a, b } from './x'` — re-export.
  src = src.replace(
    /export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?/g,
    (_, names, spec) => {
      names.split(',').map((n) => n.trim()).filter(Boolean).forEach((n) => exportedNames.add(n));
      return `Object.assign(__exports, __pick(__require(${JSON.stringify(spec)}), ${JSON.stringify(
        names.split(',').map((n) => n.trim()).filter(Boolean)
      )}));`;
    }
  );

  // `import { a, b } from './x'`
  src = src.replace(
    /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?/g,
    (_, names, spec) => `const {${names}} = __require(${JSON.stringify(spec)});`
  );

  // `import Thing from './x'`
  src = src.replace(
    /import\s+(\w+)\s+from\s*['"]([^'"]+)['"];?/g,
    (_, name, spec) => `const ${name} = __require(${JSON.stringify(spec)}).default;`
  );

  // Bare `export { a, b };`
  src = src.replace(/export\s*\{([^}]*)\};?/g, (_, names) => {
    names.split(',').map((n) => n.trim()).filter(Boolean).forEach((n) => exportedNames.add(n));
    return '';
  });

  // `export const/let/function NAME`
  for (const m of src.matchAll(/export\s+(?:const|let|function)\s+(\w+)/g)) {
    exportedNames.add(m[1]);
  }
  src = src.replace(/^\s*export\s+(?=(const|let|function|class)\s)/gm, '');

  if (/\bexport\s+default\b|^\s*import\s/m.test(src)) {
    throw new Error(
      `sync-occasions: ${path.relative(FRONTEND_SRC, absPath)} uses module syntax this loader ` +
      'does not handle (default export, or a side-effect/namespace import). Extend the loader.'
    );
  }

  const sandbox = {
    __exports: exportsObj,
    __require: (spec) => loadModule(resolveSpec(absPath, spec)),
    __pick: (obj, names) => Object.fromEntries(names.map((n) => [n, obj[n]])),
    console,
    Math,
    Date,
    JSON,
    Object,
    Array,
    Number,
    String,
    __DEV__: false,
  };

  const footer = `\n;${[...exportedNames]
    .map((n) => `try { __exports.${n} = ${n}; } catch (e) {}`)
    .join('')}`;

  vm.runInNewContext(src + footer, vm.createContext(sandbox), {
    filename: absPath,
    displayErrors: true,
  });

  return exportsObj;
}

/* ------------------------------------------------------------------ */

function generate() {
  const { OCCASIONS, VERIFIED_THROUGH } = loadModule(ENTRY);

  if (!Array.isArray(OCCASIONS) || OCCASIONS.length === 0) {
    throw new Error('sync-occasions: the catalogue came back empty — refusing to write.');
  }

  const slim = OCCASIONS.map((o) => ({
    key: o.key,
    name: o.name,
    // The push body says the wish, so a computed subtitle (a function) is of
    // no use server-side and is dropped rather than half-serialised.
    wish: o.wish,
    when: o.when,
    priority: o.priority ?? 50,
    tags: o.tags || [],
  }));

  return {
    _generated: 'by backend/scripts/sync-occasions.js — do not edit by hand',
    _source: 'frontend/src/celebrations/occasions.js',
    verifiedThrough: VERIFIED_THROUGH,
    occasions: slim,
  };
}

// Only writes when run directly, so the loader above can also be required by a
// cross-check that compares the app's resolver against the server's.
if (require.main === module) {
  const payload = generate();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(
    `[sync-occasions] Wrote ${payload.occasions.length} occasions to ` +
    `${path.relative(process.cwd(), OUT)} ` +
    `(moving festivals verified through ${payload.verifiedThrough}).`
  );
}

module.exports = { loadModule, resolveSpec, generate, FRONTEND_SRC };
