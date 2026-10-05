import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['apps/product-service/src', 'apps/inventory-service/src'];
const forbidden = /(?:from\s*['"]|import\s*['"])(?:@nestjs\/|mongodb|@nats-io\/|@stockflow\/contracts|\.\.\/infrastructure|\.\.\/presentation)/;
let failures = 0;
function visit(path: string, layer: 'domain' | 'application'): void {
  for (const entry of readdirSync(path)) {
    const file = join(path, entry);
    if (statSync(file).isDirectory()) { visit(file, layer); continue; }
    if (!file.endsWith('.ts')) continue;
    const source = readFileSync(file, 'utf8');
    const rule = layer === 'domain' ? forbidden : /(?:from\s*['"]|import\s*['"])(?:@nestjs\/|mongodb|@nats-io\/|\.\.\/infrastructure|\.\.\/presentation)/;
    if (rule.test(source)) { process.stderr.write(`Boundary violation: ${file}\n`); failures++; }
  }
}
for (const root of roots) for (const layer of ['domain', 'application'] as const) {
  try { visit(join(root, layer), layer); } catch { /* layer may be intentionally absent in early phases */ }
}
function checkFrontend(path: string): void {
  for (const entry of readdirSync(path)) {
    const file = join(path, entry);
    if (statSync(file).isDirectory()) { checkFrontend(file); continue; }
    if (!file.endsWith('.ts')) continue;
    if (/(?:apps\/(?:product-service|inventory-service|audit-worker)|mongodb|@nats-io\/|localhost:300[12])/.test(readFileSync(file, 'utf8'))) { process.stderr.write(`Frontend boundary violation: ${file}\n`); failures++; }
  }
}
checkFrontend('apps/frontend/src');
if (failures) process.exit(1);
process.stdout.write('Domain and application import boundaries pass.\n');
