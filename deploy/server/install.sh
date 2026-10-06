#!/usr/bin/env bash
set -euo pipefail

# First installation only. Never stops or replaces existing applications.
archive=${1:?Usage: install.sh /absolute/path/stockflow.tar.gz}
test "$(id -u)" -eq 0
test -f "$archive"
test ! -e /opt/stockflow
test ! -e /etc/nginx/sites-available/stockflow-ip.conf
test ! -e /etc/nginx/sites-enabled/stockflow-ip.conf
for unit in mongo nats product inventory bff audit; do
    test ! -e "/etc/systemd/system/stockflow-$unit.service"
done
for port in 3100 3101 3102 27117 4322 8322; do
    if ss -H -lnt "sport = :$port" | grep -q .; then
        echo "Port $port is already occupied; installation aborted." >&2
        exit 1
    fi
done
if getent passwd stockflow >/dev/null; then
    echo 'The stockflow user already exists; inspect before installing.' >&2
    exit 1
fi
install -d -m 0755 /opt/stockflow/{app,bin,downloads,baseline}
install -d -m 0700 /opt/stockflow/data/{mongo,nats}
nginx -T > /opt/stockflow/baseline/nginx-before.txt 2>&1
systemctl list-units --type=service --state=running --no-pager > /opt/stockflow/baseline/services-before.txt
ss -lntup > /opt/stockflow/baseline/ports-before.txt
sha256sum /etc/nginx/sites-available/devutils.click.conf > /opt/stockflow/baseline/existing-site.sha256
useradd --system --home-dir /opt/stockflow --shell /usr/sbin/nologin stockflow
tar -xzf "$archive" -C /opt/stockflow/app

cd /opt/stockflow/downloads
curl --fail --location --retry 3 --max-time 180 -o mongo.tgz https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2404-8.0.20.tgz
curl --fail --location --retry 3 --max-time 60 -o mongo.sha256 https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2404-8.0.20.tgz.sha256
expected=$(awk '{print $1}' mongo.sha256)
printf '%s  mongo.tgz\n' "$expected" | sha256sum -c -
tar -xzf mongo.tgz
install -m 0755 mongodb-linux-x86_64-ubuntu2404-8.0.20/bin/mongod /opt/stockflow/bin/mongod
curl --fail --location --retry 3 --max-time 120 -o nats.tar.gz https://github.com/nats-io/nats-server/releases/download/v2.15.0/nats-server-v2.15.0-linux-amd64.tar.gz
curl --fail --location --retry 3 --max-time 60 -o nats-checksums.txt https://github.com/nats-io/nats-server/releases/download/v2.15.0/SHA256SUMS
expected=$(awk '$2 == "nats-server-v2.15.0-linux-amd64.tar.gz" {print $1}' nats-checksums.txt)
test -n "$expected"
printf '%s  nats.tar.gz\n' "$expected" | sha256sum -c -
tar -xzf nats.tar.gz
install -m 0755 nats-server-v2.15.0-linux-amd64/nats-server /opt/stockflow/bin/nats-server
/opt/stockflow/bin/mongod --version
/opt/stockflow/bin/nats-server --version

cd /opt/stockflow/app
# Compiled artifacts are supplied by the deployment archive. Keep global npm unchanged.
NODE_OPTIONS=--max-old-space-size=256 npm install --prefix /opt/stockflow/tooling npm@10.9.2 --ignore-scripts --no-audit --no-fund --cache /opt/stockflow/npm-cache
# npm runs linked-workspace prepare hooks even with --ignore-scripts. The
# archive already contains primitives/dist; suppress only this build hook.
cp packages/primitives/package.json /opt/stockflow/baseline/primitives-package.json
node <<'JS'
const fs = require('node:fs');
const file = 'packages/primitives/package.json';
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
delete manifest.scripts.prepare;
fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
JS
NODE_OPTIONS=--max-old-space-size=256 node /opt/stockflow/tooling/node_modules/npm/bin/npm-cli.js ci --omit=dev --ignore-scripts --no-audit --no-fund --cache /opt/stockflow/npm-cache
cp /opt/stockflow/baseline/primitives-package.json packages/primitives/package.json

cat > /opt/stockflow/mongod.conf <<'EOF'
storage:
  dbPath: /opt/stockflow/data/mongo
  wiredTiger:
    engineConfig:
      cacheSizeGB: 0.25
net:
  bindIp: 127.0.0.1
  port: 27117
replication:
  replSetName: rs0
EOF
cat > /opt/stockflow/nats.conf <<'EOF'
listen: 127.0.0.1:4322
http: 127.0.0.1:8322
jetstream {
  store_dir: /opt/stockflow/data/nats
  max_memory_store: 64MB
  max_file_store: 1GB
}
EOF
cat > apps/product-service/.env <<'EOF'
PORT=3101
MONGO_URI=mongodb://127.0.0.1:27117/stockflow_product?replicaSet=rs0&directConnection=true
EOF
cat > apps/inventory-service/.env <<'EOF'
PORT=3102
MONGO_URI=mongodb://127.0.0.1:27117/stockflow_inventory?replicaSet=rs0&directConnection=true
PRODUCT_SERVICE_URL=http://127.0.0.1:3101
NATS_URL=nats://127.0.0.1:4322
EOF
cat > apps/bff/.env <<'EOF'
PORT=3100
PRODUCT_SERVICE_URL=http://127.0.0.1:3101
INVENTORY_SERVICE_URL=http://127.0.0.1:3102
EOF
cat > apps/audit-worker/.env <<'EOF'
MONGO_URI=mongodb://127.0.0.1:27117/stockflow_audit?replicaSet=rs0&directConnection=true
NATS_URL=nats://127.0.0.1:4322
EOF
chown -R stockflow:stockflow /opt/stockflow/data
chown stockflow:stockflow apps/{product-service,inventory-service,bff,audit-worker}/.env
chmod 0600 apps/{product-service,inventory-service,bff,audit-worker}/.env

cat > /etc/systemd/system/stockflow-mongo.service <<'EOF'
[Unit]
Description=StockFlow private MongoDB replica set
After=network.target
[Service]
User=stockflow
Group=stockflow
ExecStart=/opt/stockflow/bin/mongod --config /opt/stockflow/mongod.conf
Restart=always
RestartSec=5
TimeoutStopSec=60
LimitNOFILE=64000
MemoryHigh=450M
MemoryMax=550M
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/opt/stockflow/data/mongo
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/stockflow-nats.service <<'EOF'
[Unit]
Description=StockFlow private NATS JetStream
After=network.target
[Service]
User=stockflow
Group=stockflow
ExecStart=/opt/stockflow/bin/nats-server --config /opt/stockflow/nats.conf
Restart=always
RestartSec=5
LimitNOFILE=64000
MemoryMax=150M
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/opt/stockflow/data/nats
[Install]
WantedBy=multi-user.target
EOF
for component in product-service inventory-service bff audit-worker; do
    unit=${component%-service}
    unit=${unit%-worker}
    case "$component" in
        product-service) dependencies='stockflow-mongo.service' ;;
        inventory-service) dependencies='stockflow-mongo.service stockflow-nats.service stockflow-product.service' ;;
        bff) dependencies='stockflow-product.service stockflow-inventory.service' ;;
        audit-worker) dependencies='stockflow-mongo.service stockflow-nats.service' ;;
    esac
    cat > "/etc/systemd/system/stockflow-$unit.service" <<EOF
[Unit]
Description=StockFlow $component
After=network.target $dependencies
Wants=$dependencies
StartLimitIntervalSec=0
[Service]
User=stockflow
Group=stockflow
WorkingDirectory=/opt/stockflow/app/apps/$component
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
done
systemctl daemon-reload
systemctl enable --now stockflow-mongo stockflow-nats
for attempt in $(seq 1 30); do
    if ss -H -lnt 'sport = :27117' | grep -q . && curl -fsS http://127.0.0.1:8322/healthz >/dev/null; then break; fi
    sleep 1
done
node deploy/server/bootstrap-mongo.cjs
NATS_URL=nats://127.0.0.1:4322 node deploy/server/setup-nats.cjs
systemctl enable --now stockflow-product stockflow-inventory stockflow-bff stockflow-audit
for port in 3101 3102 3100; do
    ready=false
    for attempt in $(seq 1 30); do
        if curl -fsS "http://127.0.0.1:$port/health/ready"; then ready=true; break; fi
        sleep 1
    done
    test "$ready" = true
done
install -m 0644 deploy/server/nginx.conf /etc/nginx/sites-available/stockflow-ip.conf
ln -s /etc/nginx/sites-available/stockflow-ip.conf /etc/nginx/sites-enabled/stockflow-ip.conf
nginx -t
systemctl reload nginx
sha256sum -c /opt/stockflow/baseline/existing-site.sha256
curl --retry 5 --retry-all-errors --retry-delay 1 -fsS http://127.0.0.1/api/inventory -H 'Host: 52.1.135.53'
curl -fsS https://devutils.click/ -o /dev/null
echo 'StockFlow installed; public browser and end-to-end checks still required.'
