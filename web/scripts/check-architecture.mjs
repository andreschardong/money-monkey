// Enforces the atomic-design layering of web/src/app and that every source file has its spec.
//
//   atoms      -> core
//   molecules  -> atoms, core
//   organisms  -> molecules, atoms, other organisms, core
//   templates  -> organisms, molecules, atoms, core
//   pages      -> templates, organisms, molecules, atoms, core
//   core       -> core only (services, models, formatting; no components)
//
// A layer never imports from a layer above it, and a page never imports another page. Run with
// `npm run architecture` from web/; it exits 1 and lists every violation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/app');

const ALLOWED = {
  atoms: ['atoms', 'core'],
  molecules: ['atoms', 'core'],
  organisms: ['molecules', 'atoms', 'organisms', 'core'],
  templates: ['organisms', 'molecules', 'atoms', 'core'],
  pages: ['templates', 'organisms', 'molecules', 'atoms', 'core'],
  core: ['core'],
};
// Files that are type declarations or pure data and need no spec of their own.
const NO_SPEC_NEEDED = new Set(['core/models.ts']);

const walk = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const rel = (p) => path.relative(appDir, p).split(path.sep).join('/');
const layerOf = (r) => (r.includes('/') ? r.split('/')[0] : 'app');

const sources = walk(appDir)
  .map(rel)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
const specs = new Set(
  walk(appDir)
    .map(rel)
    .filter((f) => f.endsWith('.spec.ts')),
);
const problems = [];

for (const file of sources) {
  const layer = layerOf(file);
  if (layer === 'app') continue; // app.ts, app.config.ts, app.routes.ts wire everything together
  if (!(layer in ALLOWED)) {
    problems.push(`${file}: unknown folder "${layer}" (use atoms, molecules, organisms, templates, pages or core)`);
    continue;
  }
  const text = fs.readFileSync(path.join(appDir, file), 'utf8');
  for (const [, spec] of text.matchAll(/(?:from|import\()\s*'(\.{1,2}\/[^']*)'/g)) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
    if (target.startsWith('..') || !fs.existsSync(path.join(appDir, `${target}.ts`))) continue;
    const targetLayer = layerOf(`${target}.ts`);
    if (targetLayer === 'app') {
      problems.push(`${file}: imports ${target}, which is outside the layers`);
    } else if (!ALLOWED[layer].includes(targetLayer)) {
      problems.push(
        `${file}: a${layer === 'organisms' ? 'n' : ''} ${layer.replace(/s$/, '')} may not import ${target} (${targetLayer})`,
      );
    } else if (
      layer === 'pages' &&
      targetLayer === 'pages' &&
      path.posix.dirname(target) !== path.posix.dirname(file)
    ) {
      problems.push(`${file}: a page may not import another page (${target})`);
    }
  }
}

for (const file of sources) {
  if (layerOf(file) === 'app' && file !== 'app.ts' && file !== 'app.config.ts' && file !== 'app.routes.ts') continue;
  if (NO_SPEC_NEEDED.has(file)) continue;
  if (!specs.has(file.replace(/\.ts$/, '.spec.ts')))
    problems.push(`${file}: no ${path.posix.basename(file).replace(/\.ts$/, '.spec.ts')} beside it`);
}

if (problems.length > 0) {
  console.error(`Architecture check failed (${problems.length}):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`Architecture check passed: ${sources.length} source files, ${specs.size} specs.`);
