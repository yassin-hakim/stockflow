import {
  normalizeOperation,
  operationFingerprint,
  OperationError,
  planOperation,
  returnLines,
  type Balance,
  type OperationCommand,
  type OperationResult,
  type OperationPlan,
} from "../domain/operations";

export interface OperationCatalog {
  get(productId: string): Promise<{ id: string; archivedAt?: string | null }>;
}
export interface OperationStore {
  findCommand(
    key: string,
  ): Promise<{ fingerprint: string; result: OperationResult } | null>;
  locationExists(id: string): Promise<boolean>;
  supplierExists(id: string): Promise<boolean>;
  balances(
    identities: { productId: string; locationId: string }[],
  ): Promise<Balance[]>;
  commit(
    command: OperationCommand,
    fingerprint: string,
    previous: Balance[],
    plan: OperationPlan,
  ): Promise<OperationResult | null>;
  reject(
    command: OperationCommand,
    fingerprint: string,
    error: OperationError,
  ): Promise<OperationResult>;
}

export class StockOperations {
  constructor(
    private readonly store: OperationStore,
    private readonly catalog: OperationCatalog,
    private readonly currency='USD',
  ) {}
  async returnSale(input: {
    id: string;
    originalOperationId: string;
    returnedItems: { saleLineId: string; quantity: number }[];
    reason: string;
  }): Promise<OperationResult> {
    const original = await this.store.findCommand(input.originalOperationId);
    if (
      !original ||
      original.result.status !== "COMMITTED" ||
      original.result.kind !== "SALE"
    )
      throw new OperationError(
        "OPERATION_NOT_FOUND",
        "Original sale consumption not found.",
      );
    return this.execute({
      ...input,
      kind: "SALE_RETURN",
      locationId: original.result.locationId,
      reference: original.result.reference,
      lines: returnLines(original.result.command, input.returnedItems),
    });
  }
  async execute(input: OperationCommand): Promise<OperationResult> {
    const command = normalizeOperation(input),
      fingerprint = operationFingerprint(command);
    for (let attempt = 0; attempt < 3; attempt++) {
      const duplicate = await this.store.findCommand(command.id);
      if (duplicate) {
        if (duplicate.fingerprint !== fingerprint)
          throw new OperationError(
            "IDEMPOTENCY_CONFLICT",
            "This request identity belongs to different input.",
          );
        return duplicate.result;
      }
      if (
        !(await this.store.locationExists(command.locationId)) ||
        (command.destinationLocationId &&
          !(await this.store.locationExists(command.destinationLocationId)))
      )
        throw new OperationError(
          "LOCATION_NOT_FOUND",
          "Storage location not found.",
        );
      if (
        command.supplierId &&
        !(await this.store.supplierExists(command.supplierId))
      )
        throw new OperationError(
          "SUPPLIER_NOT_FOUND",
          "Supplier reference not found.",
        );
      for (const line of command.lines) {
        const product = await this.catalog.get(line.productId);
        if (
          product.archivedAt &&
          (command.kind === "RECEIPT" ||
            (command.kind === "MANUAL" && command.action === "ADD"))
        )
          throw new OperationError(
            "PRODUCT_ARCHIVED",
            "Archived products cannot receive new stock.",
          );
      }
      const identities = command.lines.flatMap((line) => [
        { productId: line.productId, locationId: command.locationId },
        ...(command.destinationLocationId
          ? [
              {
                productId: line.productId,
                locationId: command.destinationLocationId,
              },
            ]
          : []),
      ]);
      const previous = await this.store.balances(identities);
      let plan: OperationPlan;
      try {
        plan = planOperation(command, previous,new Date(),this.currency);
      } catch (error) {
        if (!(error instanceof OperationError)) throw error;
        // A matching command may have committed after the lookup but before this balance read.
        const committed = await this.store.findCommand(command.id);
        if (committed) {
          if (committed.fingerprint !== fingerprint)
            throw new OperationError(
              "IDEMPOTENCY_CONFLICT",
              "This request identity belongs to different input.",
            );
          return committed.result;
        }
        return this.store.reject(command, fingerprint, error);
      }
      const result = await this.store.commit(
        command,
        fingerprint,
        previous,
        plan,
      );
      if (result) return result;
    }
    const duplicate = await this.store.findCommand(command.id);
    if (duplicate && duplicate.fingerprint === fingerprint)
      return duplicate.result;
    if (duplicate)
      throw new OperationError(
        "IDEMPOTENCY_CONFLICT",
        "This request identity belongs to different input.",
      );
    throw new OperationError(
      "UPSTREAM_UNAVAILABLE",
      "Concurrent stock updates could not be resolved. Retry this same request.",
    );
  }
}
