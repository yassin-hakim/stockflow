# Expansion phases and acceptance tracker

Status: implementation and acceptance complete; see [current evidence](verification.md) and the [requirement-to-evidence audit](requirement-evidence.md). Every checked exit below maps to inspected runtime, test, or rendered evidence.

Read [scope](README.md), [architecture](architecture.md), [contracts/data](contracts-and-data.md), and [pages](pages.md) first. E01 reconciles approved expansion scope with the baseline documents; E12 verifies the complete connected app.

## Phase tracker

| Phase | Dependency | Result | Status |
| --- | --- | --- | --- |
| E01 | Existing app | Reconciled requirements, contracts, migration design and acceptance fixtures | Complete |
| E02 | E01 | Product management through API and Angular | Complete |
| E03 | E02 | Compound-command foundation, preserved legacy data, locations and stock views | Complete |
| E04 | E03 | Delivery receiving and atomic transfers | Complete |
| E05 | E04 | Waste and stale-safe physical counts | Complete |
| E06 | E05 | Replenishment rules and actionable stock list | Complete |
| E07 | E02, E03 | Versioned menu/recipes and integer-price semantics | Complete |
| E08 | E03, E07 | Sales process and recoverable checkout backend | Complete |
| E09 | E08 | Usable POS, pending recovery and printable receipts | Complete |
| E10 | E09 | Sale history, safe refunds and explicit stock return | Complete |
| E11 | E06, E10 | Real operational reports and CSV | Complete |
| E12 | E01–E11 | Full compatibility, failure recovery and reviewer handoff | Complete |

E07 shares dependencies with inventory operations, but the recommended execution order remains sequential to finish the operational inventory milestone first. No phase depends on scaffolding a hypothetical future feature.

Implementation boxes below establish inspected source/route/port deliverables. Exit boxes establish only the exact combined behavior stated in the box, as mapped in [requirement-evidence.md](requirement-evidence.md). Current copied-source installation/backend tests/boundaries/docs results are in `output/verification/fresh-expansion-setup.json`; actual crash/broker/Audit results are in `fresh-expansion-runtime.json`; legacy browser and filter results are in `completion-browser.json`. Later source changes need new affected checks. Unchecked exits are explicit remaining evidence work, not a claim that their feature code is absent.

## E01 — Contracts, scope and baseline

Implementation:

- [x] Reconcile `instructions.md`, requirements, architecture, domain, frontend, API, persistence, events, operations and testing documents; distinguish existing v1 behavior from planned v2 behavior.
- [x] Preserve the original requirements/acceptance trace; add X01–X13 and service-owned invariants.
- [x] Define shared DTOs, stable errors, money/quantity limits, command states, pagination, report periods and event-version rollout.
- [x] Define default-location migration, command-registry backfill, index transition, schema guards and rollback limits.
- [x] Record baseline running behavior and persisted quantities/IDs/pending events. Use isolated test fixtures; do not modify production data.

Exit gates:

- [x] Every new invariant has one named owner and a contract/test target. No BFF-owned business rule or cross-owner DB access is introduced.
- [x] Original successful stock replay, overdraw rejection and frontend pending-command behavior are reproducible against the baseline.
- [x] Migration dry-run assumptions, frozen cart/recipe semantics and pending checkout/refund outcomes are reviewable before feature code.

## E02 — Product management

Implementation:

- [x] Extend the existing Product domain/use cases/repository/controller for conditional edits, optional normalized SKU and archival.
- [x] Keep base unit immutable, preserve historical reads and define active/archive filters.
- [x] Add BFF contracts and Angular edit/search/filter/archive flows using current patterns.

Exit gates:

- [x] Unit change is rejected; SKU conflicts and stale edits have clear errors. Evidence: actual isolated Product HTTP 400/409 responses and preserved records in `catalog-http-conflicts.json`; stale browser review/keyboard recovery in `catalog-conflicts.json`.
- [x] Archival retains product/history and removes the product from new operational selection as documented.
- [x] Product edits never mutate Inventory balances; zero-stock creation and original Product APIs still work.
- [x] Desktop/mobile validation and recoverable-error input preservation are inspected.

## E03 — Location balances and compound-command foundation

Implementation:

- [x] Generalize Inventory identity and stock unit of work to location-specific, multi-balance operations.
- [x] Introduce command-result registry, operation IDs, line IDs, causes and durable terminal outcomes for new compound commands.
- [x] Upgrade Audit to accept stock v1/v2; keep existing stream retention/consumer behavior and pending v1 payloads.
- [x] Implement and dry-run the idempotent migration/backfill/index change on a copy; add schema-version startup guards.
- [x] Implement locations create/list/detail/rename, location-aware stock APIs, legacy Main Store adapters and BFF projections.
- [x] Add location selector, aggregate read view and location breakdown to Angular. Evidence: named BFF breakdown, pagination, selector regression and rendered desktop/mobile checks in [verification](verification.md).

Exit gates:

- [x] Migrated global quantities equal original quantities; old product/movement/event IDs and timestamps are unchanged.
- [x] Rerun migration without duplicates or changed results. Replay a pre-migration success and resolve a pre-migration saved browser command. Evidence: fresh runtime exact replay/rerun plus `completion-browser.json` original key, original 40 kg, one movement and cleared v1 storage at 1440/375 px.
- [x] Old APIs continue to operate on Main Store; new aggregate APIs explicitly state their scope.
- [x] Same command key with changed location/kind/input rejects. Compound operations use registry uniqueness rather than a one-movement-per-key assumption.
- [x] Concurrent balance writes cannot overdraw or lose additions; transaction rollback leaves every affected balance/document/movement/outbox unchanged.
- [x] Old pending v1 events and new v2 events are each audited once. Frontend sees only `/api` traffic.

## E04 — Receiving and transfers

Implementation:

- [x] Add Inventory-owned receiving and transfer documents, use cases, ports, transactional adapters and public/internal routes.
- [x] Add optional simple supplier references/catalog to receiving; no purchase-order workflow.
- [x] Implement multi-line forms, history/detail links, validation and uncertain-request resolution in Angular.

Exit gates:

- [x] A multi-product delivery increases all selected balances once; replay returns its original document/result. Evidence: retained live fixture `c20367ca`, receipt/result replay and changed-location conflict assertions.
- [x] A transfer decreases source and increases destination together, preserves product totals and has paired movements with one operation reference. Evidence: live fixture's four movements and 15/8 versus 5/2 source/destination balances.
- [x] One insufficient transfer line or a forced write failure leaves every line unchanged.
- [x] Two simultaneous transfers/removals cannot spend the same source quantity. A full destination does not debit the source. Evidence: real persisted-effect comparisons in `verify-inventory-expansion.ts`.
- [x] Timeout/refresh/retry creates one operation; rendered mobile line editors remain usable. Evidence: `completion-browser.json` transfer recovery at 1440/375 px, original key/input preserved after real owner commit/lost response, two paired movements, one stock effect and no overflow; receiving pending lock and storage guards are separately retained.

## E05 — Waste and physical counts

Implementation:

- [x] Add enumerated waste causes with required explanations and referenced removal movements.
- [x] Implement count-session creation, baseline version/absence snapshots, draft entry, difference review, atomic apply and cancellation.
- [x] Add BFF routes, Angular waste/count pages and document histories.

Exit gates:

- [x] Waste is distinguishable from sale consumption and transfers in records and UI; overdraw fails without side effects.
- [x] Counts support explicit zero, preserve unentered fields as unentered and compute differences on the server.
- [x] An intervening movement or concurrent apply rejects stale count state; no newly sold stock is overwritten.
- [x] Count apply commits all changed balances and document state together; unchanged count finalizes once without zero-quantity movement/events. Evidence: real count-state/outbox write faults, concurrent apply, zero-count assertions and valued-balance comparisons in `verify-inventory-expansion.ts`.
- [x] Retry after an uncertain apply returns the original count outcome; stale feedback retains comparison data without silent resubmission. Evidence: `completion-browser.json` count recovery at 1440/375 px, original apply identity, one count movement, retained 0.200/0.150/−0.050 stale comparison and unchanged authoritative 0.201 balance.

## E06 — Replenishment

Implementation:

- [x] Add versioned per-location threshold/target rules and server-side integer suggested-quantity calculation.
- [x] Extend BFF stock status projections with explicit per-location versus total threshold behavior.
- [x] Add actionable replenishment table/mobile list, policy editing and receiving links.

Exit gates:

- [x] OUT/LOW/OK remain server-provided; Angular contains no stock-status or suggested-order policy.
- [x] Boundary values, zero targets, target/threshold validation and `0.001` precision produce correct quantities.
- [x] Missing rule/target is explicit; location-specific need is not hidden by stock elsewhere.
- [x] Stock updates/counts are reflected after authoritative refetch; failure is never represented as zero stock.

## E07 — Menu, recipe revisions and prices

Implementation:

- [x] Extend Product catalog with menu item and immutable recipe revision models/use cases/repositories.
- [x] Use integer minor-unit prices with one configured two-decimal currency and integer sold counts.
- [x] Validate ingredient identities, positive base-unit milliunits, active configuration and checked multiplication limits.
- [x] Add menu APIs/BFF and Angular list/detail/editor/publish/archive flows.

Exit gates:

- [x] Latte recipe persists `0.018 kg` coffee and `0.200 L` milk without implicit unit conversion. Evidence: Product exact snapshot tests and live latte fixture.
- [x] Three items yield exactly `54` coffee milliunits and `600` milk milliunits; repeated ingredients combine without float arithmetic. Evidence: Product duplicate/milliunit tests, Sales checked allocation tests and live 4.946/1.400 balances.
- [x] Bad quantities, unknown/archived ingredient configuration and unsafe totals reject cleanly. Evidence: Product invalid recipe/currency/price tests and Sales checked multiplication overflow tests, included in retained backend run.
- [x] Publishing a new revision preserves previous revisions and existing sale snapshot interpretation. Evidence: real Product current/revision transaction and rollback/race tests plus live return after recipe edit and actual fresh-process frozen-attempt recovery.
- [x] Price display/editing round-trips integer minor units and the configured currency. Evidence: Menu exact maximum-safe/minor-unit parse and configured empty-catalog currency tests; live menu/receipt prices. Final page accessibility remains an E12 gate.

## E08 — Sales backend and checkout recovery

Implementation:

- [x] Add the independent `apps/sales-service` workspace with four layers, own MongoDB, health/config, scripts and import-boundary coverage.
- [x] Implement draft pricing/review, versioned cart edits, frozen checkout attempts, unique receipt allocation and Sales-local transactions.
- [x] Implement Sales HTTP ports to Product and Inventory; add atomic Inventory sale-bundle consume and status lookup.
- [x] Persist workflow intent before dispatch; add bounded recovery scanning and idempotent completion.
- [x] Add Sales outbox/relay, `SALES_EVENTS`, `sales-audit`, versioned event validation and audit storage without replacing the existing stock stream.
- [x] Add thin BFF endpoints with completed/rejected/pending response contracts.

Exit gates:

- [x] Completed sale has one priced snapshot, one ingredient operation, one receipt and one completion event intent. Evidence: fresh actual-process restart fixture checks owner Mongo documents for recovered sales.
- [x] Insufficient milk rejects the whole bundle: coffee is not deducted and no completed receipt exists. Evidence: live latte shortage leaves both balances unchanged and report completed count one; Sales completion-only receipt persistence is covered by owner tests.
- [x] Repeated/changed checkout keys return original result/conflict; duplicate tabs/calls do not duplicate stock or sale. Evidence: Mongo command uniqueness checks and original rejected-attempt replay after a later completed attempt in `sales.test.ts`.
- [x] Recipe/price changes before prepare require review; after prepare, retry/recovery always uses the frozen snapshot. Evidence: owner catalog-review tests and fresh actual Sales termination after Inventory commit followed by changed recipe/price and exact old checkout replay.
- [x] Crash before dispatch, after Inventory commit, and before/after Sales finalization recovers to one terminal result. Evidence: fresh runtime and `sales-restock-restart.json` actual process/Mongo finalization runs.
- [x] Sales restart resolves persisted pending attempts without browser participation. Transient Product/Inventory/Mongo outages are distinguishable from business rejection. Evidence: `sales-restock-restart.json`.
- [x] NATS outage never changes the completed HTTP business outcome; audit catches up after restart. Evidence: fresh isolated broker termination, completed receiving/Sales HTTP while offline, pending outboxes, broker restoration and exact Audit cardinality.

## E09 — POS and printable receipts

Implementation:

- [x] Add Angular menu search, consumption location, cart, counts, owner-priced totals, tender label and checkout.
- [x] Generalize client pending recovery while preserving the original stock flow; persist sale identity and show status controls.
- [x] Add receipt route and print-specific styling using immutable Sales DTOs.

Exit gates:

- [x] Desktop and mobile complete a realistic sale using keyboard/touch; no horizontal form overflow.
- [x] Double-click and timeout/refresh/navigation preserve one checkout identity and block conflicting edits.
- [x] Pending/rejected/completed states are distinct; no optimistic stock deduction or premature receipt is shown.
- [x] Browser requests use BFF only. Receipt print preview contains the recorded items/reference/total and excludes app navigation.

## E10 — Sale history and corrections

Implementation:

- [x] Add paginated sale search/detail with immutable snapshots, linked stock operations and correction history.
- [x] Implement draft cancellation, partial/full recorded refunds, cumulative limits and required reasons.
- [x] Implement explicit restock allocation validation and pending-return recovery using the original recipe.
- [x] Add correction UI, amount/quantity review, safe defaults and stock-return explanation.

Exit gates:

- [x] Prepared-food refund with no restock changes Sales records only; stock stays consumed.
- [x] Restock returns the exact original eligible ingredient allocation once; edited recipes never change old returns.
- [x] Repeated, concurrent or excessive refunds cannot exceed sold counts/money or originally consumed stock allocations.
- [x] Uncertain restock recovers after restart without duplicate return; pending corrections block overlapping correction attempts.
- [x] Original sale/movement history remains immutable; returned stock cannot exceed balance limits.

## E11 — Reports and exports

Implementation:

- [x] Add indexed, bounded owner-service queries for sales/refunds, consumption, waste, transfers and count variance.
- [x] Add BFF read composition, report UI and matching-filter CSV export.
- [x] Define explicit UTC half-open periods, browser-local filter conversion and currency/unit labels.

Exit gates:

- [x] Reports reconcile to committed source documents/movements; pending/rejected sales are excluded from completed totals.
- [x] Transfers are excluded from consumption; unlike product units are never summed into one quantity total.
- [x] Partial refunds produce correct gross/refund/net values using original price snapshots.
- [x] Pagination has stable ordering; date boundaries and location filters match visible results and CSV.
- [x] CSV text cannot execute a spreadsheet formula. Required source outages produce a visible error, never false zero totals. Evidence: current live export verifier and report error state matrix.

## E12 — Full release verification and handoff

The later approved X13 extension also requires pagination across operational lists, receiving unit costs, and sales/ingredient-cost/gross-profit reporting. See [cost reporting](../../docs/cost-reporting.md) for its valuation and historical-cost rules. The latest cost/P&L live and browser evidence is recorded in [verification](verification.md).

Implementation:

- [x] Update configure/setup/build/test/start scripts, env examples and reviewer guide for six processes and the Sales database/streams.
- [x] Reconcile canonical docs, page/service specifications, traceability and the expanded walkthrough with implemented contracts.
- [x] Add isolated integration/demo/recovery fixtures and executable verification scripts for the expanded workflow.
- [x] Run focused unit/application/HTTP tests, real MongoDB replica-set transaction/concurrency checks, JetStream/audit checks and browser acceptance.
- [x] Verify migration and fresh-clone setup separately; inspect data across process/infrastructure restarts.
- [x] Record commands, observed outputs, browser captures and database/event assertions in new expansion verification evidence.

Exit gates:

- [x] Existing build, backend/frontend tests, `check:boundaries`, `check:docs` and original stock acceptance scenario still pass where applicable.
- [x] All X01–X13 behaviors and the final demo below pass through real processes, not just mocked ports.
- [x] Broker, audit-worker, Sales-process and uncertain HTTP outcomes recover without lost/duplicate business effects.
- [x] Desktop/mobile loading/empty/error/pending/populated states, keyboard/focus and print layout are inspected.
- [x] Fresh clone and migration paths preserve documented setup/compatibility. Deployment is a separate explicitly authorized action.
- [x] No unimplemented follow-up feature is represented as shipped or exposed through placeholder navigation.

## Final interview acceptance scenario

Use a fresh isolated fixture, with currency USD and latte price `400` minor units ($4.00). Coffee's unit is kg; milk's unit is L.

1. Create Arabica Coffee and Milk, and Main Store/Bar locations.
2. Receive **20 kg coffee and 10 L milk** into Main Store in one delivery.
3. Transfer **5 kg coffee and 2 L milk** to Bar in one transfer. Main Store is **15 kg / 8 L**; Bar is **5 kg / 2 L**. Restaurant totals remain **20 kg / 10 L**.
4. Publish a latte recipe using **0.018 kg coffee + 0.200 L milk**, priced at **400** minor units.
5. Sell three lattes from Bar. The receipt total is **1200** minor units; Bar stock becomes **4.946 kg coffee / 1.400 L milk**. The consumption operation has two removal movements.
6. Record **0.100 L spilled milk** as waste. Bar milk becomes **1.300 L**; waste is separately identifiable.
7. Start a count and enter **4.900 kg coffee / 1.250 L milk**. Confirm adjustments of **−0.046 kg / −0.050 L**. Bar balances match physical counts.
8. Configure Bar milk low threshold **1.500 L**, target **3.000 L**. Replenishment shows **1.750 L** needed.
9. Attempt to sell seven more lattes, requiring **1.400 L milk**. Reject the entire bundle; both balances and completed-sales count remain unchanged.
10. Record a one-latte refund with **no restock**: original sale gross is **1200**, refund **400**, net recorded sales **800** minor units; ingredients stay consumed.
11. On separate fixtures, prove explicit restock uses the original recipe, stale counts reject, and concurrent transfers cannot overdraw.
12. Inspect every document, movement, operation identity, outbox row and eventual audit record. Repeat a timed-out checkout with the same key and restart Sales around the Inventory commit; prove one sale and one stock consumption.

## Evidence format

For each completed phase record the code revision, fixture IDs, exact commands, inspected responses/database records, browser states, expected versus actual outcome and remaining limitation. Keep plan checkboxes unchecked until that evidence exists. Record expansion evidence in [verification.md](verification.md); the original [verification](../verification.md) remains the baseline record.
