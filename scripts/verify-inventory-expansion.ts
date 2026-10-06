import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { MAX_QUANTITY_MILLIS } from "@stockflow/primitives";
import { MongoOperationsStore } from "../apps/inventory-service/src/infrastructure/mongo-operations-store";
import { StockOperations } from "../apps/inventory-service/src/application/operations";
import { InventoryManagement } from "../apps/inventory-service/src/application/inventory-management";
import type { OperationCommand } from "../apps/inventory-service/src/domain/operations";

/** Fresh isolated replica-set database. Never migrates or writes the running app databases. */
async function main() {
  const database = `stockflow_verify_inventory_${randomUUID().replaceAll("-", "")}`;
  const client = await MongoClient.connect(
    process.env.INVENTORY_VERIFY_MONGO_URI ??
      `mongodb://localhost:27017/${database}?replicaSet=rs0&directConnection=true`,
    { serverSelectionTimeoutMS: 3000 },
  );
  const db = client.db(database),
    ownedClient = {
      db: () => db,
      startSession: () => client.startSession(),
    } as MongoClient;
  try {
    await db
      .collection("inventory")
      .createIndex({ productId: 1, locationId: 1 }, { unique: true });
    await db
      .collection("stock_commands")
      .createIndex({ operationId: 1 }, { unique: true });
    await db
      .collection("stock_movements")
      .createIndex({ operationId: 1, lineId: 1 }, { unique: true });
    await db
      .collection("locations")
      .createIndex({ normalizedName: 1 }, { unique: true });
    const store = new MongoOperationsStore(ownedClient);
    await store.setup();
    const productId = randomUUID(),
      milk = randomUUID(),
      locationId = randomUUID(),
      destinationLocationId = randomUUID(),
      soldLine = randomUUID();
    for (const [id, name] of [
      [locationId, "Store"],
      [destinationLocationId, "Bar"],
    ])
      await store.saveLocation(
        {
          id,
          name,
          version: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        null,
      );
    const catalog = { get: async (id: string) => ({ id }) },
      operations = new StockOperations(store, catalog),
      management = new InventoryManagement(store, catalog, operations);
    const command = (
      kind: OperationCommand["kind"],
      lines: OperationCommand["lines"] = [{ productId, quantityMillis: 5000 }],
    ): OperationCommand => ({
      id: randomUUID(),
      kind,
      locationId,
      lines,
      reason: "Verification",
      reference: "VERIFY",
      ...(kind === "TRANSFER" ? { destinationLocationId } : {}),
    });
    const receive = command("RECEIPT", [
      { productId, quantityMillis: 20000 },
      { productId: milk, quantityMillis: 10000 },
    ]);
    const received = await operations.execute(receive);
    assert.equal(received.status, "COMMITTED");
    assert.deepEqual(await operations.execute(receive), received);
    await assert.rejects(
      () =>
        operations.execute({ ...receive, locationId: destinationLocationId }),
      /different input/,
    );
    await assert.rejects(
      () =>
        operations.execute({ ...command("RECEIPT"), supplierId: randomUUID() }),
      /Supplier/,
    );
    const supplier = await management.saveSupplier(
      randomUUID(),
      "Dairy supply",
      "Weekly contact",
      null,
    );
    assert.equal(supplier.version, 0);
    assert.equal(
      (
        await operations.execute({
          ...command("RECEIPT", [{ productId: milk, quantityMillis: 1000 }]),
          supplierId: supplier.id,
        })
      ).status,
      "COMMITTED",
    );
    // Real Mongo validation failure after balance writes proves transaction rollback.
    const fail = { ...command("TRANSFER"), reason: "FORCE_FAIL" };
    const before = await db
      .collection("inventory")
      .find()
      .sort({ productId: 1, locationId: 1 })
      .toArray();
    await db.command({
      collMod: "stock_movements",
      validator: { reason: { $ne: "FORCE_FAIL" } },
      validationAction: "error",
    });
    await assert.rejects(() => operations.execute(fail));
    assert.deepEqual(
      await db
        .collection("inventory")
        .find()
        .sort({ productId: 1, locationId: 1 })
        .toArray(),
      before,
    );
    assert.equal(
      await db
        .collection("stock_commands")
        .countDocuments({ _id: fail.id as any }),
      0,
    );
    assert.equal(
      await db
        .collection("outbox")
        .countDocuments({ "payload.operationId": fail.id }),
      0,
    );
    await db.command({ collMod: "stock_movements", validator: {} });
    const race = await Promise.all([
      operations.execute(
        command("TRANSFER", [{ productId, quantityMillis: 15000 }]),
      ),
      operations.execute(
        command("TRANSFER", [{ productId, quantityMillis: 15000 }]),
      ),
    ]);
    assert.deepEqual(race.map((row) => row.status).sort(), [
      "COMMITTED",
      "REJECTED",
    ]);
    const sale = {
      ...command("SALE", [
        { productId, quantityMillis: 54 },
        { productId: milk, quantityMillis: 600 },
      ]),
      allocations: [
        {
          saleLineId: soldLine,
          quantity: 3,
          ingredients: [
            { productId, quantityMillis: 18 },
            { productId: milk, quantityMillis: 200 },
          ],
        },
      ],
    };
    assert.equal((await operations.execute(sale)).status, "COMMITTED");
    const returnKey = randomUUID(),
      returned = {
        id: returnKey,
        originalOperationId: sale.id,
        returnedItems: [{ saleLineId: soldLine, quantity: 1 }],
        reason: "Sealed return",
      };
    const outcome = await operations.returnSale(returned);
    assert.equal(outcome.status, "COMMITTED");
    assert.deepEqual(await operations.returnSale(returned), outcome);
    const returns = await Promise.all([
      operations.returnSale({
        ...returned,
        id: randomUUID(),
        returnedItems: [{ saleLineId: soldLine, quantity: 2 }],
      }),
      operations.returnSale({
        ...returned,
        id: randomUUID(),
        returnedItems: [{ saleLineId: soldLine, quantity: 2 }],
      }),
    ]);
    assert.deepEqual(returns.map((row) => row.status).sort(), [
      "COMMITTED",
      "REJECTED",
    ]);
    assert.equal(
      (await store.balances([{ productId, locationId }]))[0].quantityMillis,
      5000,
    );
    const countKey = randomUUID(),
      snapshot = await management.createCount(
        countKey,
        locationId,
        [productId, milk],
        "Physical count",
      );
    assert.deepEqual(
      await management.createCount(
        countKey,
        locationId,
        [milk, productId],
        "Physical count",
      ),
      snapshot,
    );
    await assert.rejects(
      () => operations.execute({ ...command("RECEIPT"), id: countKey }),
      /count creation/,
    );
    await assert.rejects(
      () => management.applyCount(countKey, 0, randomUUID()),
      /Enter every/,
    );
    const edited = await management.editCount(countKey, 0, [
      { productId, countedMillis: 4900 },
      { productId: milk, countedMillis: 10950 },
    ]);
    const applyKey = randomUUID(),
      applied = await management.applyCount(countKey, edited.version, applyKey);
    assert.equal(applied.status, "COMMITTED");
    assert.deepEqual(
      await management.applyCount(countKey, edited.version, applyKey),
      applied,
    );
    assert.equal((await management.count(countKey)).status, "APPLIED");
    const stale = await management.createCount(
      randomUUID(),
      locationId,
      [productId],
      "Stale safety",
    );
    await management.editCount(stale.id, 0, [{ productId, countedMillis: 0 }]);
    await operations.execute({
      ...command("MANUAL", [{ productId, quantityMillis: 1 }]),
      action: "ADD",
    });
    assert.equal(
      (await management.applyCount(stale.id, 1, randomUUID())).error?.code,
      "COUNT_STALE",
    );
    assert.equal((await management.count(stale.id)).status, "DRAFT");
    const absentProduct = randomUUID(),
      absent = await management.createCount(
        randomUUID(),
        locationId,
        [absentProduct],
        "Absent zero safety",
      );
    await management.editCount(absent.id, 0, [
      { productId: absentProduct, countedMillis: 0 },
    ]);
    const zero = await management.applyCount(absent.id, 1, randomUUID());
    assert.equal(zero.movements.length, 0);
    assert.equal(zero.status, "COMMITTED");
    const secondZero = await management.createCount(
      randomUUID(),
      locationId,
      [absentProduct],
      "Unchanged zero",
    );
    await management.editCount(secondZero.id, 0, [
      { productId: absentProduct, countedMillis: 0 },
    ]);
    assert.equal(
      (await management.applyCount(secondZero.id, 1, randomUUID())).movements
        .length,
      0,
    );
    await management.saveRule(productId, locationId, 5000, 6000, null);
    const needed = (await management.replenishment(locationId)).find(
      (row) => row.productId === productId,
    )!;
    assert.equal(needed.suggestedQuantity, 1.099);
    await assert.rejects(
      () => management.saveRule(productId, locationId, 5000, 4000, 0),
      /Target/,
    );
    const report = await store.report({ locationId }, undefined, 2);
    assert.ok(report.nextCursor);
    assert.equal(
      report.products.find((row) => row.productId === productId)
        ?.consumedQuantity,
      0.054,
    );
    assert.equal(
      report.products.find((row) => row.productId === productId)
        ?.transferOutQuantity,
      15,
    );
    const second = await store.report({ locationId }, report.nextCursor!, 2);
    assert.ok(
      second.items.every(
        (row) => !report.items.some((first) => first.id === row.id),
      ),
    );
    const boundary = await store.report(
      { from: report.items[0].createdAt, to: report.items[0].createdAt },
      undefined,
      100,
    );
    assert.equal(boundary.items.length, 0);

    // Compare persisted business records, including cost values, rather than only row counts.
    const effectCollections = ["inventory", "count_sessions", "stock_movements", "outbox", "receipts", "transfers", "waste_records"];
    const persistedEffects = async (includeCommands = false) =>
      Object.fromEntries(await Promise.all(
        [...effectCollections, ...(includeCommands ? ["stock_commands"] : [])].map(async (name) =>
          [name, await db.collection(name).find().sort({ _id: 1 }).toArray()] as const),
      ));
    const rejectedWithoutEffects = async (
      input: OperationCommand,
      code: string,
      executor = operations,
    ) => {
      const before = await persistedEffects();
      const result = await executor.execute(input);
      assert.equal(result.status, "REJECTED");
      assert.equal(result.error?.code, code);
      assert.equal(result.movements.length, 0);
      assert.deepEqual(await persistedEffects(), before);
      assert.deepEqual((await store.findCommand(input.id))?.result, result);
      assert.deepEqual(await executor.execute(input), result);
      assert.deepEqual(await persistedEffects(), before);
    };
    const forceCollectionFailure = async (
      collection: string,
      validator: Record<string, unknown>,
      action: () => Promise<unknown>,
    ) => {
      await db.command({ collMod: collection, validator, validationAction: "error" });
      try {
        await assert.rejects(action, (error: unknown) =>
          typeof error === "object" && error !== null && "code" in error && error.code === 121);
      } finally {
        await db.command({ collMod: collection, validator: {} });
      }
    };

    // A valid source cannot be debited when the destination already holds its limit.
    const capacityProduct = randomUUID();
    await operations.execute(command("RECEIPT", [{ productId: capacityProduct, quantityMillis: 1000, unitCostMinor: 0 }]));
    await operations.execute({ ...command("RECEIPT", [{ productId: capacityProduct, quantityMillis: MAX_QUANTITY_MILLIS, unitCostMinor: 0 }]), locationId: destinationLocationId });
    await rejectedWithoutEffects(command("TRANSFER", [{ productId: capacityProduct, quantityMillis: 1 }]), "STOCK_LIMIT_EXCEEDED");

    // Distinct simultaneous apply identities can finalize the same count only once.
    const raceProduct = randomUUID();
    await operations.execute(command("RECEIPT", [{ productId: raceProduct, quantityMillis: 2000, unitCostMinor: 500 }]));
    const racingCount = await management.createCount(randomUUID(), locationId, [raceProduct], "Concurrent count apply");
    await management.editCount(racingCount.id, 0, [{ productId: raceProduct, countedMillis: 1900 }]);
    const countKeys = [randomUUID(), randomUUID()];
    const beforeCountRace = await persistedEffects();
    const countRace = await Promise.allSettled(countKeys.map((key) => management.applyCount(racingCount.id, 1, key)));
    const winners = countRace.flatMap((result, index) => result.status === "fulfilled" && result.value.status === "COMMITTED" ? [{ result: result.value, key: countKeys[index] }] : []);
    assert.equal(winners.length, 1);
    for (const result of countRace) {
      if (result.status === "rejected") assert.equal(result.reason.code, "VERSION_CONFLICT");
      else if (result.value.status === "REJECTED") assert.equal(result.value.error?.code, "COUNT_STALE");
    }
    const finalizedCount = await management.count(racingCount.id);
    assert.equal(finalizedCount.status, "APPLIED");
    assert.equal(finalizedCount.version, 2);
    assert.equal(finalizedCount.operationId, winners[0].key);
    assert.equal(await db.collection("stock_commands").countDocuments({ "command.countId": racingCount.id, "result.status": "COMMITTED" }), 1);
    const raceBalance = (await store.balances([{ productId: raceProduct, locationId }]))[0];
    assert.equal(raceBalance.quantityMillis, 1900);
    assert.equal(raceBalance.valueMinor, 950);
    const afterCountRace = await persistedEffects();
    assert.equal(afterCountRace.stock_movements.length - beforeCountRace.stock_movements.length, 1);
    assert.equal(afterCountRace.outbox.length - beforeCountRace.outbox.length, 1);
    assert.deepEqual(await management.applyCount(racingCount.id, 1, winners[0].key), winners[0].result);
    assert.deepEqual(await persistedEffects(), afterCountRace);

    // Faults before and after count-state writes roll back both valued balances and all records.
    const valuedProduct = randomUUID(), secondValuedProduct = randomUUID();
    await operations.execute(command("RECEIPT", [
      { productId: valuedProduct, quantityMillis: 3000, unitCostMinor: 1000 },
      { productId: secondValuedProduct, quantityMillis: 3000, unitCostMinor: 2000 },
    ]));
    const faultCount = await management.createCount(randomUUID(), locationId, [valuedProduct, secondValuedProduct], "FORCE_COUNT_FAIL");
    await management.editCount(faultCount.id, 0, [
      { productId: valuedProduct, countedMillis: 2500 },
      { productId: secondValuedProduct, countedMillis: 2750 },
    ]);
    const faultCountKey = randomUUID(), beforeCountFailure = await persistedEffects(true);
    await forceCollectionFailure("count_sessions", { $or: [{ status: { $ne: "APPLIED" } }, { reason: { $ne: "FORCE_COUNT_FAIL" } }] },
      () => management.applyCount(faultCount.id, 1, faultCountKey));
    assert.deepEqual(await persistedEffects(true), beforeCountFailure);
    assert.equal(await store.findCommand(faultCountKey), null);
    // This failure happens after count state and a movement have already been written in the transaction.
    await forceCollectionFailure("outbox", { "payload.operationId": { $ne: faultCountKey } },
      () => management.applyCount(faultCount.id, 1, faultCountKey));
    assert.deepEqual(await persistedEffects(true), beforeCountFailure);
    assert.equal(await store.findCommand(faultCountKey), null);
    const recoveredCount = await management.applyCount(faultCount.id, 1, faultCountKey);
    assert.equal(recoveredCount.status, "COMMITTED");
    assert.equal(recoveredCount.movements.length, 2);
    assert.equal(recoveredCount.movements.reduce((sum, row) => sum + row.costMinor!, 0), 1000);
    assert.equal((await management.count(faultCount.id)).status, "APPLIED");
    const valuedBalances = await store.balances([{ productId: valuedProduct, locationId }, { productId: secondValuedProduct, locationId }]);
    assert.equal(valuedBalances.find((row) => row.productId === valuedProduct)?.valueMinor, 2500);
    assert.equal(valuedBalances.find((row) => row.productId === secondValuedProduct)?.valueMinor, 5500);

    // Priced receipt failure rolls back carrying value and its document, then the same key commits once.
    const pricedReceipt = command("RECEIPT", [{ productId: valuedProduct, quantityMillis: 1000, unitCostMinor: 1000 }]);
    const beforePricedFailure = await persistedEffects(true);
    await forceCollectionFailure("outbox", { "payload.operationId": { $ne: pricedReceipt.id } }, () => operations.execute(pricedReceipt));
    assert.deepEqual(await persistedEffects(true), beforePricedFailure);
    assert.equal(await store.findCommand(pricedReceipt.id), null);
    const recoveredReceipt = await operations.execute(pricedReceipt);
    assert.equal(recoveredReceipt.status, "COMMITTED");
    assert.equal(recoveredReceipt.movements[0].costMinor, 1000);
    assert.deepEqual(await operations.execute(pricedReceipt), recoveredReceipt);
    assert.equal((await store.balances([{ productId: valuedProduct, locationId }]))[0].valueMinor, 3500);

    // Currency and aggregate monetary overflow rejections persist only their terminal outcome.
    await rejectedWithoutEffects(command("RECEIPT", [{ productId: valuedProduct, quantityMillis: 1000, unitCostMinor: 1000 }]),
      "CURRENCY_MISMATCH", new StockOperations(store, catalog, "EUR"));
    await rejectedWithoutEffects(command("RECEIPT", [
      { productId: randomUUID(), quantityMillis: 1000, unitCostMinor: Number.MAX_SAFE_INTEGER },
      { productId: randomUUID(), quantityMillis: 1000, unitCostMinor: 1 },
    ]), "INVALID_REQUEST");

    // Unconfigured balance rows stay explicit, and stock in another location cannot hide need.
    const policyProduct = randomUUID(), noRuleProduct = randomUUID(), emptyPolicyProduct = randomUUID();
    await operations.execute(command("RECEIPT", [{ productId: noRuleProduct, quantityMillis: 1, unitCostMinor: 0 }]));
    await operations.execute({ ...command("RECEIPT", [{ productId: policyProduct, quantityMillis: 100000, unitCostMinor: 0 }]), locationId: destinationLocationId });
    await management.saveRule(policyProduct, locationId, 1, 3, null);
    await management.saveRule(emptyPolicyProduct, locationId, 0, 0, null);
    const replenishmentRow = async (id: string, scope = locationId) =>
      (await management.replenishment(scope)).find((row) => row.productId === id)!;
    assert.deepEqual(await replenishmentRow(noRuleProduct), {
      productId: noRuleProduct, locationId, quantity: 0.001,
      lowStockThreshold: null, targetQuantity: null, suggestedQuantity: null, version: null,
    });
    assert.deepEqual(await replenishmentRow(emptyPolicyProduct), {
      productId: emptyPolicyProduct, locationId, quantity: 0,
      lowStockThreshold: 0, targetQuantity: 0, suggestedQuantity: 0, version: 0,
    });
    assert.equal((await replenishmentRow(policyProduct)).suggestedQuantity, 0.003);
    assert.equal((await replenishmentRow(policyProduct)).quantity, 0);
    assert.equal((await replenishmentRow(policyProduct, destinationLocationId)).quantity, 100);
    assert.equal((await replenishmentRow(policyProduct, destinationLocationId)).targetQuantity, null);
    await operations.execute(command("RECEIPT", [{ productId: policyProduct, quantityMillis: 1, unitCostMinor: 0 }]));
    // Equality with the 0.001 threshold still needs exactly 0.002; crossing it stops suggestions.
    assert.equal((await replenishmentRow(policyProduct)).quantity, 0.001);
    assert.equal((await replenishmentRow(policyProduct)).suggestedQuantity, 0.002);
    await operations.execute(command("RECEIPT", [{ productId: policyProduct, quantityMillis: 1, unitCostMinor: 0 }]));
    assert.equal((await replenishmentRow(policyProduct)).suggestedQuantity, 0);
    const policyCount = await management.createCount(randomUUID(), locationId, [policyProduct], "Replenishment refetch");
    await management.editCount(policyCount.id, 0, [{ productId: policyProduct, countedMillis: 0 }]);
    await management.applyCount(policyCount.id, 1, randomUUID());
    assert.equal((await replenishmentRow(policyProduct)).quantity, 0);
    assert.equal((await replenishmentRow(policyProduct)).suggestedQuantity, 0.003);
    await management.saveRule(policyProduct, locationId, 0, 0, 0);
    assert.equal((await replenishmentRow(policyProduct)).version, 1);
    assert.equal((await replenishmentRow(policyProduct)).suggestedQuantity, 0);
    const savedRule = await store.rules(locationId);
    await assert.rejects(() => management.saveRule(policyProduct, locationId, 1, 3, 0), (error: any) => error.code === "VERSION_CONFLICT");
    await assert.rejects(() => management.saveRule(policyProduct, locationId, 2, 1, 1), (error: any) => error.code === "INVALID_QUANTITY");
    await assert.rejects(() => management.replenishment(randomUUID()), (error: any) => error.code === "LOCATION_NOT_FOUND");
    assert.deepEqual(await store.rules(locationId), savedRule);

    // A response-lost transfer can be resolved and replayed from fresh adapters after later writes.
    const recoveryProduct = randomUUID(), shortageProduct = randomUUID();
    await operations.execute(command("RECEIPT", [{ productId: recoveryProduct, quantityMillis: 1000, unitCostMinor: 1000 }]));
    await rejectedWithoutEffects(command("TRANSFER", [
      { productId: recoveryProduct, quantityMillis: 100 },
      { productId: shortageProduct, quantityMillis: 1 },
    ]), "INSUFFICIENT_STOCK");
    const frozenTransfer = command("TRANSFER", [{ productId: recoveryProduct, quantityMillis: 100 }]);
    const transferOutcome = await operations.execute(frozenTransfer);
    assert.equal(transferOutcome.status, "COMMITTED");
    await operations.execute(command("RECEIPT", [{ productId: recoveryProduct, quantityMillis: 1000, unitCostMinor: 1000 }]));
    const reloadedStore = new MongoOperationsStore(ownedClient);
    const reloadedOperations = new StockOperations(reloadedStore, catalog);
    const reloadedManagement = new InventoryManagement(reloadedStore, catalog, reloadedOperations);
    const beforeRecovery = await persistedEffects(true);
    assert.deepEqual(await reloadedStore.operation(frozenTransfer.id), transferOutcome);
    assert.deepEqual(await reloadedOperations.execute(frozenTransfer), transferOutcome);
    await assert.rejects(() => reloadedOperations.execute({ ...frozenTransfer, lines: [{ productId: recoveryProduct, quantityMillis: 101 }] }), (error: any) => error.code === "IDEMPOTENCY_CONFLICT");
    assert.deepEqual(await persistedEffects(true), beforeRecovery);

    // Count creation/apply recovery preserves its snapshot and final outcome after later stock changes.
    const recoveryCountKey = randomUUID();
    const recoveryCount = await management.createCount(recoveryCountKey, locationId, [recoveryProduct], "Durable count recovery");
    assert.deepEqual(await reloadedManagement.createCount(recoveryCountKey, locationId, [recoveryProduct], "Durable count recovery"), recoveryCount);
    await reloadedManagement.editCount(recoveryCountKey, 0, [{ productId: recoveryProduct, countedMillis: 1800 }]);
    const recoveryApplyKey = randomUUID();
    const countOutcome = await reloadedManagement.applyCount(recoveryCountKey, 1, recoveryApplyKey);
    await operations.execute(command("RECEIPT", [{ productId: recoveryProduct, quantityMillis: 1000, unitCostMinor: 1000 }]));
    const afterLaterReceipt = await persistedEffects(true);
    assert.deepEqual(await store.operation(recoveryApplyKey), countOutcome);
    assert.deepEqual(await management.applyCount(recoveryCountKey, 1, recoveryApplyKey), countOutcome);
    await assert.rejects(() => management.applyCount(recoveryCountKey, 2, recoveryApplyKey), (error: any) => error.code === "IDEMPOTENCY_CONFLICT");
    assert.equal((await management.count(recoveryCountKey)).operationId, recoveryApplyKey);
    assert.equal((await store.balances([{ productId: recoveryProduct, locationId }]))[0].quantityMillis, 2800);
    assert.deepEqual(await persistedEffects(true), afterLaterReceipt);
    assert.equal(
      await db.collection("stock_movements").countDocuments(),
      await db.collection("outbox").countDocuments(),
    );
    process.stdout.write(
      `Inventory verification passed in isolated ${database}: atomic bundles/forced rollback/concurrent transfers/full destination, immutable allocation/cumulative returns, suppliers/counts/stale and absent zero/replay/concurrent apply/count-state and post-count outbox rollback, valued receipt rollback/currency and aggregate-cost rejection, replenishment zero/missing policy/location/0.001 boundaries/authoritative count refetch, durable transfer/count status and original-result recovery, report/cursor/time bounds/outbox cardinality.\n`,
    );
  } finally {
    await db.dropDatabase();
    await client.close();
  }
}
void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
