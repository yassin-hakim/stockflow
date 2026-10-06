const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const stage = path.join(root, '.tools', 'deployment-20261006', 'stage');
if (fs.existsSync(stage)) throw new Error('Deployment stage already exists.');
fs.mkdirSync(stage, { recursive: true });
const files = cp.execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(Boolean);
for (const relative of files) {
  const dest = path.join(stage, relative);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(root, relative), dest);
}
for (const relative of [
  'apps/product-service/dist', 'apps/inventory-service/dist', 'apps/bff/dist',
  'apps/sales-service/dist', 'apps/audit-worker/dist', 'apps/frontend/dist', 'packages/primitives/dist',
  'packages/contracts/dist', 'deploy/server',
  'apps/frontend/src/app/core/stock-request-key.ts',
  'apps/frontend/src/app/core/stock-request-key.spec.ts',
]) {
  fs.cpSync(path.join(root, relative), path.join(stage, relative), { recursive: true });
}
for (const [source, target] of [
  ['scripts/setup-nats.ts', 'deploy/server/setup-nats.cjs'],
  ['scripts/lib/nats-configuration.ts', 'deploy/server/lib/nats-configuration.js'],
  ['scripts/verify-demo.ts', 'deploy/server/verify-demo.cjs'],
]) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, source), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const dest = path.join(stage, target);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, code);
}
cp.execFileSync('tar.exe', ['-czf', path.join(stage, '..', 'stockflow.tar.gz'), '-C', stage, '.']);
console.log(path.join(stage, '..', 'stockflow.tar.gz'));
