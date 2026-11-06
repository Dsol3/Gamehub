#!/usr/bin/env node
// Bundles the game into ONE self-contained HTML file (no server, no imports).
//   node build.mjs   ->  dist/overdraft.html
// Each ES module is wrapped in its own IIFE scope so top-level names can't collide.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

const NAMESPACE = {
  './sim.js': '__sim', './render.js': '__render', './audio.js': '__audio',
  './layout.js': '__layout', './share.js': '__share',
};

function exportedNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1]);
  }
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop().trim();
      if (n) names.add(n);
    }
  }
  return [...names];
}

function transpile(src) {
  const imports = [];
  src = src.replace(
    /^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?\s*$/gm,
    (_, spec, from) => {
      const ns = NAMESPACE[from];
      if (!ns) throw new Error(`unknown import source: ${from}`);
      // `foo as bar` is ESM-only syntax: it must become `foo: bar` in a destructure.
      // Emitting it raw produces a SyntaxError that kills the entire bundle.
      const names = spec
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const m = s.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
          return m ? `${m[1]}: ${m[2]}` : s;
        });
      imports.push(`const { ${names.join(', ')} } = ${ns};`);
      return '';
    }
  );
  const exportsList = exportedNames(src);
  const body = src
    .replace(/^export\s*\{[^}]*\};?\s*$/gm, '')
    .replace(/^export\s+(const|let|var|function|class)\s/gm, '$1 ')
    .replace(/^export\s+default\s+/gm, 'const __default = ');
  return { imports: imports.join('\n'), body, exportsList };
}

function wrap(name, file) {
  const { imports, body, exportsList } = transpile(read(file));
  return `const ${name} = (() => {\n${imports}\n${body}\nreturn { ${exportsList.join(', ')} };\n})();`;
}

const parts = [
  // layout first: sim and render both read its constants
  wrap('__layout', 'src/layout.js'),
  wrap('__sim', 'src/sim.js'),
  // share.js has no imports of its own, so it can sit anywhere before render
  wrap('__share', 'src/share.js'),
  wrap('__render', 'src/render.js'),
  wrap('__audio', 'src/audio.js'),
];
// main runs for its side effects only
const mainT = transpile(read('src/main.js'));
parts.push(`(() => {\n${mainT.imports}\n${mainT.body}\n})();`);

const bundle = `(() => {\n'use strict';\n${parts.join('\n\n')}\n})();`;

let html = read('index.html');
html = html.replace(
  /<script type="module" src="\.\/src\/main\.js"><\/script>/,
  '<script>\n' + bundle.replace(/<\/script>/g, '<\\/script>') + '\n</script>'
);
// The text below the canvas links to the media kit. In the repo that page is at
// docs/kit/, but the shipped copies sit IN docs/ (which Vercel and Pages serve as
// the web root), so the same link has to point at kit/ instead. Without this the
// only download page in the game 404s in production — the exact reason the media
// kit was invisible on Vercel.
html = html.replace(/href="docs\/kit\/"/g, 'href="kit/"');

// dist/ = the shareable file, docs/ = what GitHub Pages serves as the live site
for (const dir of ['dist', 'docs']) mkdirSync(join(root, dir), { recursive: true });
writeFileSync(join(root, 'dist/overdraft.html'), html);
writeFileSync(join(root, 'docs/index.html'), html);

// PWA bits ship next to the HTML (a manifest has to be a separate file, and the
// icons have to be real PNGs, so they cannot live inside the single-file bundle).
const copyFile = (from, to) => writeFileSync(join(root, to), readFileSync(join(root, from)));
// The repo-root manifest points at assets/; the shipped copies sit flat beside
// their icons, so rewrite the paths on the way out.
const manifest = JSON.parse(read('manifest.json'));
for (const ic of manifest.icons) ic.src = ic.src.replace(/^assets\//, '');
for (const dir of ['docs', 'dist']) {
  writeFileSync(join(root, dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}
for (const n of ['192', '512']) {
  copyFile(`assets/icon-${n}.png`, `docs/icon-${n}.png`);
  copyFile(`assets/icon-${n}.png`, `dist/icon-${n}.png`);
}
console.log(
  `wrote dist/overdraft.html + docs/index.html ` +
  `(${(Buffer.byteLength(html) / 1024).toFixed(1)} KB, single file, zero dependencies)`
);
