# Historical fresh-clone baseline verification — 2026-10-05

This report is preserved historical evidence for the original five-process stock app. It predates Sales, location migration, recipes, POS and corrections. It does not prove the complete-app expansion is freshly cloned, installed or accepted. Current expansion proof is recorded separately in [expansion verification](../implementation/expansion/verification.md), with its own revision, fixture and command evidence.

Verification started from a new clone of public `yassin-hakim/stockflow` at `f997cdc2f1d3f544f78fe2fdf4a01477ffda95ba`, without copying dependencies, environment files or application edits from the working checkout. The setup fixes published with this report were applied and exercised in that clone.

## Dependency and build checks

| Check | Observed result |
| --- | --- |
| `npm ci` | Fresh locked installation succeeded: 524 packages installed, 0 reported vulnerabilities |
| `npm ls --depth=0` | All five application workspaces, contracts and declared dependencies resolved; no missing-package errors |
| `npm run build` | Contracts, Product, Inventory, BFF, audit worker and Angular built successfully |
| `npm test` | 17 backend/domain/application tests passed across 6 files |
| Angular tests | 10 tests passed across 5 files |
| `npm run check:boundaries` | Inward dependency checks passed |
| `npm run configure` | Created all four missing `.env` files; repeat execution preserved them. Hash comparison after customization confirmed none was overwritten |
| Lockfile update | Only root runtime-engine metadata changed; dependency versions were preserved |

## Fresh infrastructure and startup

Docker Compose started new MongoDB and NATS containers with new, empty named volumes under an independent review project. To avoid the existing developer stack, the test used MongoDB port 27117, NATS 4322/8322, Product 3101, Inventory 3102, BFF 3100 and Angular 4300. These were test-only port overrides; the published examples retain the default ports in the [review guide](review-guide.md).

- MongoDB `rs0` was initialized from scratch. The revised setup waited until the node was writable before returning success. A second invocation validated the existing set and returned ready.
- NATS setup created `STOCK_EVENTS` and `stock-audit` from scratch; repeat setup succeeded.
- All four compiled backend `npm run start -w ...` commands started using their workspace `.env` files. Product, Inventory and BFF readiness returned HTTP 200; the worker attached to the durable consumer.
- All four root backend `dev:*` commands also started from the clone. Their readiness and audit-consumer attachment passed.
- Angular started with the development server, returned HTTP 200, and proxied `/api/inventory` to the isolated BFF. The known demo Product returned quantity 40 and status `OK` through that proxy.

## Full workflow results

`verify:demo` passed first against compiled backends, then against the documented development startup. Both runs checked creation at logical zero, add 50, remove 10, rejected removal of 50, original-result idempotency replay, conflicting-key rejection, exactly two movements/outbox/audit records, concurrent-removal safety and concurrent first additions.

| Startup path | Core Product | Concurrent removal Product | Concurrent first-add Product |
| --- | --- | --- | --- |
| Compiled | `84f6e366-7c9d-4fb6-857a-3db8c2de85aa` | `b5b64e00-9bbd-4702-8974-069cdcfcdbcd` | `b7412460-02d5-408a-940e-b7eadc961ada` |
| Development | `59f4aaa6-c735-4c84-acce-63f2c0df9b50` | `c2cb076f-b488-4821-8c4f-2ab16af4a84b` | `0ea00eb7-01d7-4f3d-ac65-44a1ec76edf1` |

The review used Node 22.16.0, npm 10.9.2, Windows host applications and Docker Compose 2.40.3 through WSL, with the pinned MongoDB 8.0.20 and NATS 2.15.0 images. No separately installed Angular/Nest CLI, MongoDB server, NATS server, private registry or external credentials were needed. macOS/Linux instructions follow the same Node/Compose topology but were not executed on a separate machine. This check proves local startup and workflow; it does not deploy a hosted app.

See the earlier [implementation verification](../implementation/verification.md) for the full UI, accessibility, rollback and outage evidence.
