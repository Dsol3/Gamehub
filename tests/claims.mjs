// Claim-drift guard: any size we publish has to match the file we ship.
//
// This exists because the kit page said "179 KB", the README said "~57 KB", and
// the actual bundle was 201 KB — two different lies about the same file, both
// drifting slowly as features were added. A test that reads the claim and the
// artifact together makes that class of error impossible to ship, and it is how
// we keep the README promise that every claim in it is true.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log('PASS ' + msg);
  else { console.log('FAIL ' + msg); failures++; }
};

const bundle = join(root, 'docs/index.html');
ok(existsSync(bundle), 'docs/index.html exists (run `npm run build` first)');
const bytes = readFileSync(bundle).length;
const kb = Math.round(bytes / 1024);
console.log(`\nbundle: ${bytes} bytes = ${kb} KB\n`);

// ---- the kit page is read by humans, so it must quote the real number ----
const kit = read('docs/kit/index.html');
const kitClaim = kit.match(/One (\d+) KB HTML file/);
ok(!!kitClaim, 'kit page still makes a size claim (the sentence exists)');
if (kitClaim) {
  const claimed = Number(kitClaim[1]);
  // a rounded KB figure may drift by a hair between builds; anything more is a lie
  ok(Math.abs(claimed - kb) <= 1,
    `kit says ${claimed} KB and the bundle is ${kb} KB (within 1 KB)`);
}

// ---- the README documents the build output ----
const readme = read('README.md');
const readmeClaim = readme.match(/dist\/overdraft\.html, single file, ~(\d+) KB/);
ok(!!readmeClaim, 'README documents the build size');
if (readmeClaim) {
  const claimed = Number(readmeClaim[1]);
  ok(Math.abs(claimed - kb) <= 1,
    `README says ~${claimed} KB and the bundle is ${kb} KB (within 1 KB)`);
}

// ---- the tweet says "under 200KB": that is now false, so it must not appear ----
// If this ever fails, the fix is to correct the copy, not to delete the check.
const kitUnder200 = /[Uu]nder 200\s*KB/.test(kit);
ok(!kitUnder200, 'kit page does not claim "under 200KB" (bundle is ' + kb + ' KB raw)');

// ---- the single-file promise is real ----
const html = readFileSync(bundle, 'utf8');
ok(!/<script[^>]+src=/.test(html), 'no external <script src> in the bundle');
ok(!/<link[^>]+rel=["']stylesheet/.test(html), 'no external stylesheet in the bundle');
ok(!/import\s+.*\s+from\s+['"]\./.test(html), 'no unresolved relative ESM imports in the bundle');

console.log(failures ? `\n${failures} CLAIM DRIFT(S)` : '\nCLAIMS MATCH THE SHIPPED FILE');
process.exit(failures ? 1 : 0);
