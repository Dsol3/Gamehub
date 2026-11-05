#!/usr/bin/env node
// Bundles the game into ONE self-contained HTML file (no server, no imports).
//   node build.mjs   ->  dist/overdraft.html
// Each ES module is wrapped in its own IIFE scope so top-level names can't collide.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

const NAMESPACE = { './sim.js': '__sim', './render.js': '__render', './audio.js': '__audio' };

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
      const names = spec.split(',').map((s) => s.trim()).filter(Boolean);
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
  wrap('__sim', 'src/sim.js'),
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

// dist/ = the shareable file, docs/ = what GitHub Pages serves as the live site
for (const dir of ['dist', 'docs']) mkdirSync(join(root, dir), { recursive: true });
writeFileSync(join(root, 'dist/overdraft.html'), html);
writeFileSync(join(root, 'docs/index.html'), html);
console.log(
  `wrote dist/overdraft.html + docs/index.html ` +
  `(${(Buffer.byteLength(html) / 1024).toFixed(1)} KB, single file, zero dependencies)`
);
