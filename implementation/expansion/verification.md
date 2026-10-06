# Expansion implementation evidence

Status: complete. The full X01–X13 and E01–E12 implementation and acceptance evidence is recorded here and in the [requirement evidence map](requirement-evidence.md). Original baseline evidence is preserved below and in [the baseline record](../verification.md).

## Latest inspected artifacts, 2026-10-06

The current working tree and a clean copied-source review tree passed the final broad checks: `npm test` passed 176 backend tests across 24 files with no skips when the Product and Sales Mongo test URIs were enabled; the Angular suite passed 82 tests across 15 files; `npm run build` compiled all six applications with a 299.94 kB initial Angular bundle; `npm run check:boundaries` passed; and `npm run check:docs` passed 531 local links. The complete command record is in `output/verification/final-source-check.json`.

| Artifact | Observed evidence |
| --- | --- |
| `output/verification/fresh-expansion-runtime.json` | Successful isolated run `7abeadd6826948d583cab5d6acb8c6b8` from `.tools/expansion-review-20261006`, with owner-specific new databases and ports 3100–3104/4300, separate NATS 14222. Actual Sales termination before dispatch/after Inventory commit recovered using frozen recipe/price. One receipt/consumption/event per sale, offline-broker commits/catch-up, Audit restart, real Audit database validation failure/retry, exact legacy replay, rerun migration, v1/v2 and Sales deduplication passed. Eight stock/five Sales events were inspected. |
| `.tools/expansion-review-20261006/source-manifest.json` and `output/verification/fresh-expansion-setup.json` | The copied-source setup artifact records clean `npm ci` with 526 packages, configure preservation of five customized environment files, a six-app build, 304 source files and manifest SHA-256 `ba89b9e539f5bbc9496adbbadb24403ba46bb38b4832d5a687c7e0ea4de296d3`; the copied source passed 176 backend tests, 82 frontend tests, boundaries and 531 documentation links. |
| `output/verification/cost-reporting.json` | Receiving cost fixture `muwuj63g`; sale `b3d178da-5773-4b49-94bb-b325bc76e050`. Sale ingredient cost 300 minor units remains historical; after two recorded refunds, revenue is 0, remaining ingredient cost 150 and gross profit −150. Cursor report retains full-period totals. The inspected verifier also asserts unknown historical cost, cost-sensitive replay, transfer valuation and readable CSV. |
| `output/playwright/redesign-route-audit.json`, `redesign-breakpoint-audit.json`, `redesign-state-audit.json`, `redesign-lock-audit.txt` | Earlier rendered route/width/label audits and loading/empty/error/pending receiving lock evidence, with associated screenshots/PDF. See [frontend redesign](frontend-redesign.md) for recorded snapshot details. These earlier captures do not automatically sign off later code changes. |
| `output/verification/completion-browser.json` and `output/playwright/completion-{product,operations}-{1440,375}.png` | Four rendered views/36 API requests prove named stock-location breakdown/pagination, selected scope, movement cause/date and operation type/location/date response, invalid periods blocked and scope preserved after reload. |
| `output/verification/completion-browser.json`, migration section; `migrated-command-{1440,375}.png` | The actual pre-migration saved browser command for product `e60dcfbb-d8bf-49cc-9fe2-d2eca5007b63` restores 40 kg and original reason/key `cb1cb227-108a-4c7e-baf2-e20d5e680390`, posts the legacy endpoint without a location field, returns original quantity 40, keeps one movement and clears saved storage. Both widths have no overflow. |
| `output/verification/completion-browser.json`, transfer/count sections | At 1440/375 px, a real committed transfer whose response is replaced by HTTP 503 retains the original key/inputs across browser recovery and produces exactly two paired movements/one stock effect. Count apply retains its original identity, ends APPLIED with one movement, and stale comparison remains 0.200/0.150/−0.050 while actual stock stays 0.201. No horizontal overflow. |
| `output/verification/catalog-http-conflicts.json` and `catalog-conflicts.json` | Actual Product SKU/stale 409 and unit-field 400 preserve committed values. A 390 px browser keeps stale-edit input, shows current saved comparison, requires deliberate review and saves via Space/Tab/Enter. Original recipe revision 1 remains retrievable after 101 revisions (USD 4.00 original versus USD 5.00 current). |
| `output/playwright/inventory-frontend-state-matrix.json` and `output/playwright/inventory-stock-label.json` | 96 checks at 1440/375 px cover list/report loading/empty/error, Product detail states, unavailable/quota storage, and correction retests. Reports hide totals on error; unavailable storage sends no mutations. Four initial Locations/POS error/empty failures are preserved and superseded by successful later retests. The later Product blocked-action check confirms disabled Add/Remove labels remain action labels while an active request alone shows “Saving…”. |
| `output/verification/sales-restock-restart.json` | Actual Sales termination before and after Inventory commit recovers one pending restock command, movement and event; Product outage, Inventory outage, business rejection and Mongo validator failure remain distinguishable and recover after owner restart. |
| `output/playwright/sales-browser-final.json` | Current POS and correction browser acceptance at 700/701/375/1440 px covers owner pricing, keyboard flow, lost-response recovery, immutable receipt/print view, partial no-restock refund, full original-recipe restock and excessive/concurrent correction limits with no overflow or page errors. |
| `output/playwright/receiving-waste-recovery.json`, `receiving-waste-cardinality.json`, `replenishment-browser.json` | Desktop/mobile receiving and waste validation/recovery/cardinality plus missing, zero, precision and authoritative replenishment states are retained with no duplicate effects. |
| `output/verification/report-exports.json` | Live inventory, sales and P&L exports using matching location/date filters contain readable names, escaped quotes, formula-safe leading cells and no raw UUIDs. |

Earlier counts and bundle warnings below describe historical runs only. The current totals and final artifacts above are authoritative for this completed implementation.

## Baseline, 2026-10-06

- Inspected current tracked/untracked changes before implementation; preserved existing deployment files and frontend UUID fix.
- `npm test`: 12 files, 90 tests passed before expansion edits.
- No listeners were present on the normal local app/infrastructure ports during the initial inventory.
- Approved expansion scope is reconciled in `instructions.md` and requirements; existing architectural constraints remain mandatory.

## Earlier inspected implementation evidence, 2026-10-06

| Check | Observed result |
| --- | --- |
| Full `npm run build` | All six applications compiled. This earlier initial Angular bundle was 520.38 kB; later route lazy loading removed that historical warning. |
| Backend `npm test` | Last full run: 142 passed, five optional real-Mongo checks skipped. Product and Sales real-Mongo checks were separately exercised by their workspace runs. New audit tests require the next full run. |
| Angular `npm run test -w @stockflow/frontend -- --watch=false` | 61 tests passed across 12 files, including menu, POS/refund recovery, counts, reports and baseline behavior. Subsequent browser-driven refinements require another focused run. |
| `npm run check:boundaries` | Product, Inventory, Sales and frontend import boundaries passed. |
| `npm run check:docs` | Local Markdown links passed; canonical expansion documentation is being reconciled. |
| `scripts/verify-inventory-migration.ts` | Existing-data migration preserved identifiers, quantities, times, legacy replay and v1 outbox payloads; rerun created no duplicates. |
| `scripts/verify-fresh-inventory.ts` | Collection-free database migration, schema guard, adapter initialization and repeat migration passed. |
| `scripts/verify-inventory-expansion.ts` | Real Mongo rollback, concurrent overdraw, cumulative stock returns, counts including absent/unchanged zero, rules and bounded report/history queries passed. |
| `scripts/verify-sales-recovery.ts` | Real Mongo rollback, concurrent command/receipt/event uniqueness, persisted recovery before dispatch/after Inventory commit/before Sales finalization, frozen snapshots and refund recovery/limits passed. |
| `npm run verify:atomicity` | Forced legacy outbox write failure left balance, movement and outbox unchanged after schema migration. |
| `npm run verify:demo` | After all-service restart: original 0 → 50 → 40/rejected 50, concurrent removal, concurrent first addition and eventual audit assertions passed. |
| `scripts/verify-expansion-demo.ts` | Complete live BFF scenario passed: receiving/replay, atomic transfer, recipe/checkout/receipt, waste, count/apply/replay, replenishment, whole-bundle shortage, no-restock refund, historical-recipe restock, refund limit, stale count, report paging/CSV and persisted audit cardinality. |

The successful expanded fixture is `c20367ca`; the retained output is `output/expansion-demo.json`. Sale `4bbe72ec-eac9-4f5f-84e1-bcf3858e6ef4` produced one receipt. Fourteen committed stock events and three Sales events were inspected in Audit. Earlier failed verifier runs remain separate fixtures; their failures were response-status mismatch and an incorrect verifier lookup using a Mongo-generated Sales outbox `_id` instead of its `eventId`. The corrected verifier passed.

## Runtime restart

At the user's request, MongoDB/NATS were restarted through Compose without deleting named volumes. All six application processes were restarted from the rebuilt code. Ports 3000–3003 reported ready, Angular on 4200 returned HTTP 200, both containers were healthy, and Audit attached to `stock-audit` and `sales-audit`. The original and expanded live scenarios passed afterward. No production deployment occurred.

## Earlier browser workflow evidence

The Playwright `expansion` session uses installed cached Chromium against `http://localhost:4200`.

- Product create/edit was exercised with the base unit disabled on edit.
- POS reviewed a server-priced draft for Latte `c20367ca`, recipe revision 2, at 450 minor units. Checkout completed Sale `16c0e8cb-4677-46f1-854f-c52ad0ca574b`; its receipt rendered the frozen price/tender.
- Desktop and mobile POS review captures and a receipt capture/PDF are under `output/playwright/`.
- Browser inspection identified a missing mobile cart shortcut and identity-tracking warnings. Later redesign/auto-pricing/human-readable-record checks are recorded in [frontend redesign](frontend-redesign.md).

## Completion record

The final current-source checks, CSV export safety, actual restock process restart, source-outage distinctions, browser POS/correction flows, migration replay, transfer/count recovery, receiving/waste recovery, replenishment boundaries and report error states are all retained in the artifacts above. Deployment remains a separate action and was not performed.
