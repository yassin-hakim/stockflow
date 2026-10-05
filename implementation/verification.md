# Implementation verification and evidence

Checked on 2026-10-05 with Node.js 22.16.0/npm 10.9.2, the five host-run applications, and Docker Compose 2.40.3 in WSL Ubuntu. The pinned `mongo:8.0.20` and `nats:2.15.0-alpine` containers are healthy. Compose publishes their ports on `127.0.0.1`; MongoDB is initialized as `rs0`. A clean source copy was installed and built on this machine; no separate second-machine setup was performed. The root Docker command is available inside WSL, not directly in Windows PowerShell.

## Repeatable checks

| Command | Observed result |
| --- | --- |
| `npm ci` | Locked workspace dependencies installed successfully in a clean source copy. |
| `npm audit` | 0 vulnerabilities. |
| `npm run build` | Contracts and all five app projects compile; Angular production bundle generated. |
| `npm test` | 17 backend/domain/application tests passed across 6 files. |
| `npm run test -w @stockflow/frontend -- --watch=false` | 10 Angular tests passed across 5 files, including uncertain outcomes, validation focus, and duplicate-submit protection. |
| `npm run check:boundaries` | Domain/application import rules passed; a deliberately forbidden import fixture was rejected. |
| `npm run check:docs` | 313 local Markdown links checked after adding the technology source map. |
| `npm run setup:mongo` | Existing `rs0` detected and validated. |
| `npm run setup:nats` | `STOCK_EVENTS` and durable consumer `stock-audit` ready; repeated setup is idempotent. |
| `npm run verify:api` | Public and internal Product/Inventory routes, validation, projection, errors and idempotency passed for Product `bcd139ac-8c2d-4642-a049-6b4f6b385c5d`. |
| `npm run verify:atomicity` | Forced transaction failure left balance, movement and outbox unchanged for Product `b4c00a13-3751-475f-b931-4d0e658a70a6`. |
| `npm run verify:dedup` | Duplicate delivery produced one audit row; conflicting payload was rejected for event `81e1e65d-cd8e-4f56-9364-db365630ac39`. |
| `npm run verify:demo` | Product `1a147a5f-007f-492a-9b57-3b765362f7e4`: 0 → 50 → 40, rejected 50, exactly 2 movements/outbox/audit rows. Concurrent removals from 40 yielded one 200, one 409, final 10. Concurrent first adds of 30 + 20 both succeeded, final 50, 2 movements and 2 audit rows. |
| `npm run verify:nats-outage -- prepare/offline/recover` | NATS was stopped after preparation; stock committed while event `4e7f57ba-8394-4713-ad11-1a2128e164aa` remained pending for Product `3ed7a857-7e14-4368-9a3f-51f2c2b78d90`. After NATS restarted, recovery verified one published event and one matching audit row. |
| Live readiness after NATS recovery | Angular `/`, BFF, Product Service and Inventory Service readiness endpoints each returned HTTP 200; `setup:nats` confirmed `STOCK_EVENTS` and `stock-audit` ready. |
| MongoDB readiness stop/start drill | With MongoDB stopped, Product, Inventory and BFF readiness returned 503. After `up -d --wait`, `setup:mongo` and recovery, all three returned 200. |
| `npm run verify:product-reload -- c2a7d2f3-62f9-4cd4-b8fa-f04fb43460d6` | Product fields reloaded unchanged after a Product Service restart. |
| `npm run verify:infrastructure-restart -- audit fc67cd8b-8f82-4d1f-a602-46cbe4fdb142` | The JetStream event retained across the Compose restart was persisted once by the audit worker. The matching `check` mode had confirmed the MongoDB marker and pending JetStream delivery after restart. |
| `npm run verify:ui-records -- 72afbce7-f02c-45dc-aeaf-69ae189a677d` | Browser-created Product ended at 40 kg with 2 movements, 2 published outbox events and matching audit rows. |

The manual recovery drills also exercised Inventory and Product outages, NATS outage with outbox catch-up, audit-worker restart through the same durable consumer, and audit MongoDB outage with unacknowledged redelivery. These drills were observed against the running services; they are documented separately from the repeatable verifier commands.

## Browser and accessibility evidence

Playwright drove the current Angular build through Product creation, initial `0 kg`/`OUT`, add `50 kg`, remove `10 kg`, newest-first movement history, and rejected removal of `50 kg`. The final page remained at `40 kg`, displayed a readable insufficient-stock alert, and showed only the two successful movements. MongoDB and audit records matched. The observed expected `409` response produced a browser network console entry; no client-side exception prevented recovery or state refresh.

The browser request trace contained only `/api/...` application calls, including `POST /api/products`, stock add/remove and the expected rejected removal. A production bundle scan found no internal service, MongoDB or NATS URLs. Viewport checks at 375 px and 1280 px showed no horizontal overflow. Axe reported no violations on the dashboard, product creation, product detail, wildcard route and invalid Product/Stock form states at both widths. Keyboard navigation, form error focus, accessible names, validation relationships, status/alert roles and the page heading focus on route changes were checked. A human screen-reader session was not performed.

## Infrastructure persistence evidence

Compose health checks reported MongoDB and NATS healthy. `setup:mongo` confirmed the initialized replica set; `setup:nats` reported the stream and consumer ready. During the Compose `down`/`up -d --wait` restart test, a MongoDB marker and a pending JetStream event survived without deleting volumes. The worker then consumed that event and stored one audit row. Product persistence was separately checked after restarting Product Service.

## Phase status

All eight implementation phases have completed their code and local acceptance gates. Evidence includes clean dependency installation, build and test suites, service/API checks, transaction and concurrency scenarios, NATS/audit recovery, the Angular walkthrough, and Compose volume persistence. Automated accessibility and keyboard checks passed; a human screen-reader sign-off remains outside this local verification record.
