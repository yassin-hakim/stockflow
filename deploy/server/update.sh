#!/usr/bin/env bash
set -euo pipefail

ARCHIVE=${1:?usage: update.sh /home/ubuntu/stockflow-update.tar.gz}
APP=/opt/stockflow/app
RELEASES=/opt/stockflow/releases
STAMP=$(date -u +%Y%m%d%H%M%S)
RELEASE="$RELEASES/$STAMP"
BASELINE=/opt/stockflow/baseline/update-$STAMP
TOOLING=/opt/stockflow/tooling
NPM_CACHE=/opt/stockflow/npm-cache

test "$(id -u)" -eq 0
test -s "$ARCHIVE"
test -d "$APP"
test -x /usr/bin/node
install -d -m 0755 "$RELEASE" "$BASELINE" "$RELEASES"
systemctl list-unit-files stockflow-product.service stockflow-inventory.service stockflow-bff.service stockflow-audit.service >/dev/null

systemctl list-units --type=service --state=running --no-legend > "$BASELINE/services-before.txt"
ss -lntup > "$BASELINE/ports-before.txt"
sha256sum /etc/nginx/sites-available/devutils.click.conf > "$BASELINE/devutils.click.sha256"

tar -xzf "$ARCHIVE" -C "$RELEASE"
for component in product-service inventory-service sales-service audit-worker bff; do
  if test -f "$APP/apps/$component/.env"; then
    install -m 0600 "$APP/apps/$component/.env" "$RELEASE/apps/$component/.env"
  fi
done

cat > "$RELEASE/apps/sales-service/.env" <<'EOF'
PORT=3103
MONGO_URI=mongodb://127.0.0.1:27117/stockflow_sales?replicaSet=rs0&directConnection=true
MONGO_DB=stockflow_sales
PRODUCT_URL=http://127.0.0.1:3101
INVENTORY_URL=http://127.0.0.1:3102
NATS_URL=nats://127.0.0.1:4322
CURRENCY=USD
EOF
chmod 0600 "$RELEASE/apps/sales-service/.env"

upsert_env() {
  local file=$1 key=$2 value=$3
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}
upsert_env "$RELEASE/apps/bff/.env" SALES_SERVICE_URL http://127.0.0.1:3103

cd "$RELEASE"
install -d -m 0755 "$TOOLING" "$NPM_CACHE"
NODE_OPTIONS=--max-old-space-size=256 npm install --prefix "$TOOLING" npm@10.9.2 --ignore-scripts --no-audit --no-fund --cache "$NPM_CACHE"
cp packages/primitives/package.json "$BASELINE/primitives-package.json"
node - <<'JS'
const fs = require('node:fs');
const file = 'packages/primitives/package.json';
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
delete manifest.scripts.prepare;
fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
JS
NODE_OPTIONS=--max-old-space-size=256 node "$TOOLING/node_modules/npm/bin/npm-cli.js" ci --omit=dev --ignore-scripts --no-audit --no-fund --cache "$NPM_CACHE"
cp "$BASELINE/primitives-package.json" packages/primitives/package.json

systemctl stop stockflow-bff stockflow-audit stockflow-inventory stockflow-product
MONGO_URI='mongodb://127.0.0.1:27117/stockflow_inventory?replicaSet=rs0&directConnection=true' node deploy/server/migrate-inventory.cjs > "$BASELINE/inventory-migration.json"
NATS_URL='nats://127.0.0.1:4322' node deploy/server/setup-nats.cjs > "$BASELINE/nats-setup.json"

mv "$APP" "$RELEASES/retired-$STAMP"
mv "$RELEASE" "$APP"

cat > /etc/systemd/system/stockflow-sales.service <<'EOF'
[Unit]
Description=StockFlow sales-service
After=network.target stockflow-mongo.service stockflow-nats.service stockflow-product.service stockflow-inventory.service
Wants=stockflow-mongo.service stockflow-nats.service stockflow-product.service stockflow-inventory.service
StartLimitIntervalSec=0
[Service]
User=stockflow
Group=stockflow
WorkingDirectory=/opt/stockflow/app/apps/sales-service
Environment=NODE_ENV=production
ExecStart=/usr/bin/node --max-old-space-size=96 --env-file=.env dist/main.js
Restart=always
RestartSec=5
TimeoutStopSec=30
MemoryMax=180M
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/stockflow-bff.service <<'EOF'
[Unit]
Description=StockFlow bff
After=network.target stockflow-product.service stockflow-inventory.service stockflow-sales.service
Wants=stockflow-product.service stockflow-inventory.service stockflow-sales.service
StartLimitIntervalSec=0
[Service]
User=stockflow
Group=stockflow
WorkingDirectory=/opt/stockflow/app/apps/bff
Environment=NODE_ENV=production
ExecStart=/usr/bin/node --max-old-space-size=96 --env-file=.env dist/main.js
Restart=always
RestartSec=5
TimeoutStopSec=30
MemoryMax=180M
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
[Install]
WantedBy=multi-user.target
EOF

chown -R root:root "$APP"
chown -R stockflow:stockflow /opt/stockflow/data
systemctl daemon-reload
systemctl enable stockflow-sales
systemctl start stockflow-product stockflow-inventory stockflow-sales stockflow-bff stockflow-audit

for port in 3101 3102 3103 3100; do
  ready=false
  for attempt in $(seq 1 40); do
    if curl -fsS "http://127.0.0.1:$port/health/ready" >/dev/null; then ready=true; break; fi
    sleep 1
  done
  if [ "$ready" != true ]; then
    systemctl status stockflow-bff stockflow-sales stockflow-inventory --no-pager || true
    exit 1
  fi
done

sha256sum /etc/nginx/sites-available/devutils.click.conf > "$BASELINE/devutils.click.after.sha256"
cmp -s "$BASELINE/devutils.click.sha256" "$BASELINE/devutils.click.after.sha256"
systemctl list-units --type=service --state=running --no-legend > "$BASELINE/services-after.txt"
ss -lntup > "$BASELINE/ports-after.txt"
curl -fsS http://127.0.0.1/health/ready -H 'Host: 52.1.135.53' > "$BASELINE/public-ready.json"
printf 'StockFlow update %s completed.\n' "$STAMP"
