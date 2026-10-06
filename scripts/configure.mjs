import { copyFileSync, constants, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
for (const name of ['product-service', 'inventory-service', 'sales-service', 'bff', 'audit-worker']) {
  const destination = fileURLToPath(new URL(`apps/${name}/.env`, root));
  if (existsSync(destination)) {
    console.log(`Preserved apps/${name}/.env`);
    continue;
  }
  copyFileSync(new URL(`apps/${name}/.env.example`, root), destination, constants.COPYFILE_EXCL);
  console.log(`Created apps/${name}/.env`);
}
