// Updates the asset list and version in sw.js from the files in the repo.
// Usage: node tools/stamp-sw.mjs
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const INCLUDE = ['index.html', 'manifest.webmanifest', 'css', 'js', 'vendor', 'fonts', 'icons'];

function walk(p) {
  const full = join(root, p);
  if (statSync(full).isDirectory()) return readdirSync(full).flatMap((f) => walk(join(p, f)));
  return /\.(map|md|txt)$/.test(p) || /LICENSE/.test(p) ? [] : [p];
}

const files = INCLUDE.flatMap(walk).map((f) => relative(root, join(root, f)).split('\\').join('/')).sort();
const hash = createHash('sha256');
for (const f of files) hash.update(f).update(readFileSync(join(root, f)));
const version = hash.digest('hex').slice(0, 10);

const swPath = join(root, 'sw.js');
const sw = readFileSync(swPath, 'utf8');
const block = `// BEGIN GENERATED\nconst VERSION = '${version}';\nconst ASSETS = ${JSON.stringify(['./', ...files], null, 2)};\n// END GENERATED`;
writeFileSync(swPath, sw.replace(/\/\/ BEGIN GENERATED[\s\S]*?\/\/ END GENERATED/, block));
console.log(`sw.js: version ${version}, ${files.length} files`);
