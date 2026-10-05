import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const roots = [join(root, 'README.md'), join(root, 'docs'), join(root, 'implementation')];

function files(path: string): string[] {
  if (extname(path) === '.md') return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => files(join(path, entry.name)));
}

const broken: string[] = [];
let checked = 0;
for (const path of roots.flatMap(files)) {
  const source = readFileSync(path, 'utf8');
  for (const match of source.matchAll(/!?(?:\[[^\]]*\])\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^(?:https?:|mailto:|data:)/i.test(target)) continue;
    checked++;
    if (!existsSync(resolve(dirname(path), decodeURIComponent(target)))) broken.push(`${path}: ${target}`);
  }
}
if (broken.length) throw new Error(`Broken documentation links:\n${broken.join('\n')}`);
process.stdout.write(`Checked ${checked} local Markdown links.\n`);
