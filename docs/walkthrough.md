# Complete restaurant operations walkthrough

This is the reviewer scenario for the implemented expansion, not a claim that final runtime/browser acceptance has passed. Record observed HTTP responses, documents, movements, outbox/Audit rows and rendered states in [expansion verification](../implementation/expansion/verification.md). Earlier [baseline evidence](../implementation/verification.md) remains the stock-only historical proof.

## Application and ownership

Angular calls only the `/api` BFF. Product owns ingredients/menu/recipe snapshots, Inventory owns every location balance/stock operation, Sales owns priced drafts/attempts/receipts/corrections, and Audit consumes immutable notifications. Six applications run independently over four owner databases and two JetStream streams. [Architecture](architecture.md) and [technology source map](technology-guide.md#source-and-verification-map) connect these responsibilities to code.

## 1. Create ingredients and storage locations

Create **Arabica Coffee**, unit **kg**, category **Coffee**, and **Milk**, unit **L**, category **Dairy**. Product writes only its own catalog. The BFF projects a known ingredient with no successfully-read balance as zero; source outages remain errors. Keep the migrated **Main Store** and create **Bar** from Locations.

Use [product management](../apps/product-service/src/application/product-use-cases.ts) for conditional edits/SKU/archive. Unit remains immutable, SKU uniqueness is normalized, and archival preserves historical identities. No stock change occurs when a product is renamed or archived.

## 2. Receive one delivery

Open **Receive delivery**, choose Main Store, enter delivery reference/reason and optional saved supplier. Receive **20 kg coffee + 10 L milk** in one document. Both additions commit together and the operation/reference remain inspectable.

[StockOperations](../apps/inventory-service/src/application/operations.ts) normalizes the entire command and checks location/products/supplier; [MongoOperationsStore](../apps/inventory-service/src/infrastructure/mongo-operations-store.ts) atomically commits balances, receiving document, command result, two movements and two stock v2 outbox intents. A replay returns its original result. A changed input with the same key conflicts.

## 3. Transfer ingredients to Bar

Transfer **5 kg coffee + 2 L milk** from Main Store to Bar with a reference/reason. Main Store becomes **15 kg / 8 L**, Bar **5 kg / 2 L**; restaurant totals stay **20 kg / 10 L**. The operation has four paired movements linked by one ID. No partial delivery/transfer success is shown.

On a separate fixture test one insufficient source line, a full destination and simultaneous competing transfers. Inspect every balance/document/movement/outbox: transaction failure or overdraw leaves the complete bundle unchanged. Domain planning uses integer milliunits and version-checked persistence retries current balances.

## 4. Publish a latte recipe

Open Menu and create **Latte**, price **400 USD minor units ($4.00)**, recipe **0.018 kg coffee + 0.200 L milk per item**. Product validates active ingredients and saves an immutable revision. Duplicate ingredient lines combine using checked integer arithmetic. No unit conversion is implied.

[MenuCatalog](../apps/product-service/src/application/menu-use-cases.ts) and [MongoMenuRepository](../apps/product-service/src/infrastructure/mongo-menu-repository.ts) conditionally publish the current item and immutable historical snapshot together. A later price/recipe revision must not reinterpret an existing sale or return.

## 5. Complete three lattes at POS

Choose Bar, add three lattes, review Sales-priced total **1200 minor units**, select recorded Cash/Card tender and complete checkout. Tender is a label, not a gateway payment. Expected stock becomes **4.946 kg coffee / 1.400 L milk**, with one immutable receipt and two ingredient removal movements.

[SalesUseCases](../apps/sales-service/src/application/sales-use-cases.ts) prices a draft from Product snapshots, checks reviewed version/configuration, then stores a frozen checkout attempt before Inventory dispatch. Its ingredient bundle is exactly **54 coffee milliunits + 600 milk milliunits**. Inventory commits the whole consumption once. Sales subsequently commits sale completion, unique receipt and one completion-event intent locally.

There is no transaction across Sales and Inventory. Interruptions can expose `CHECKOUT_PENDING`; the POS preserves identity and offers status/retry. [Background recovery](../apps/sales-service/src/infrastructure/background-work.ts) resumes stored attempts after restart. It checks/resends the original Inventory UUID and frozen input, then finalizes once. Never infer failure solely from timeout/404 or allocate a replacement key.

## 6. Record waste and reconcile a count

Record **0.100 L spilled milk** at Bar as categorized waste; milk becomes **1.300 L**. Waste has its own operation cause and explanation, separate from sale consumption.

Start a physical count for coffee/milk. Snapshot time and recorded quantities are visible. Enter **4.900 kg / 1.250 L**, save/review server differences **-0.046 kg / -0.050 L**, deliberately confirm and apply. Stock now matches these physical quantities.

[InventoryManagement](../apps/inventory-service/src/application/inventory-management.ts) distinguishes blank/null from explicit zero and captures balance version/absence. An intervening movement or concurrent count apply rejects stale state. The screen retains entered comparison data and requires a fresh snapshot/physical recount. Unchanged lines finalize without zero-quantity movements/events. Applied count state and all balances commit together.

## 7. Configure replenishment

Set Bar milk threshold **1.500 L**, target **3.000 L**. Inventory returns suggestion **1.750 L** from current **1.250 L**, and BFF returns location-specific status/labels. Stock elsewhere does not hide Bar's need. Unconfigured targets show configuration guidance with null suggestion, not an invented order amount.

The [Replenishment screen](../apps/frontend/src/app/inventory/replenishment.ts) uses owner-calculated suggestion and policy version, preserves invalid/stale input, and refetches authoritative stock after policy changes. Receive a delivery through the linked workflow when appropriate.

## 8. Reject a bundle and record a correction

Attempt seven more lattes requiring **1.400 L milk**. The entire checkout rejects; coffee and milk balances, completed-sale count and receipts remain unchanged.

For the original three-latte sale, record a **one-latte refund with no stock return**. Original gross is **1200**, refund **400**, net recorded sales **800 minor units**. Ingredients remain consumed. The correction defaults to no restock and explains its effect.

On a separate fixture explicitly return eligible ingredients. Sales derives refund amount from original prices and applies cumulative sold-count limits. Inventory derives stock from the original consumed per-item recipe/location and bounds cumulative returned counts, including concurrent requests. A changed current recipe cannot alter that historical return. Uncertain chosen restock exposes `REFUND_PENDING` and recovers using its original operation identity.

## 9. Inspect real reports and notifications

Reports show committed facts over explicit UTC half-open `[from,to)` periods and selected location. Inventory groups quantities by ingredient/unit, distinguishing consumption, waste, transfer directions and count variance. Sales reports show recorded gross/refund/net minor units, excluding pending/rejected outcomes. Refunds belong to their correction occurrence period; a refund can appear in a period after its original sale.

CSV uses matching filters, reads all pages up to 10,000 rows and protects user text from spreadsheet formulas. Required source failure is an error, not zero totals. Receipt printing uses original immutable data and excludes navigation/actions.

Inventory relay publishes stock v1/v2 to `STOCK_EVENTS`; Sales publishes its v1 events to `SALES_EVENTS`. Audit consumes both durable queues, stores unique event IDs/full payloads and acknowledges only after persistence. A broker/worker outage delays notifications without reversing committed business outcomes. Inspect both owner outboxes and eventual Audit records; HTTP success alone does not prove event consumption.

## Original baseline compatibility

`/api/inventory` and its add/remove/history routes remain Main Store adapters with original result shapes and pending browser keys. `npm run verify:demo` exercises logical zero → add 50 → remove 10 → 40 → rejected removal 50, replay/concurrency and stock audit. [Migration](persistence.md#inventory-schema-migration) preserves old IDs/timestamps/replay results and pending v1 envelopes. This remains a compatibility gate alongside the complete-app scenario.

## Reproduce and assess the proof

[Review setup](review-guide.md) starts six applications; [testing](testing.md) lists unit, real Mongo, HTTP, broker, migration, restart, browser and print gates. `npm run verify:inventory-expansion` proves isolated real transaction invariants with a fake Product port. [Sales recovery fixture](../scripts/verify-sales-recovery.ts) exercises Sales persistence and controlled fault ports. Neither substitutes for connected real-service/broker/browser acceptance. Record exact commands, fixture IDs and observed state before checking off an expansion phase.
