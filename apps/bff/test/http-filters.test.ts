import { ArgumentsHost, HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { HttpErrorFilter as BffFilter } from "../src/http-filter";
import { HttpErrorFilter as ProductFilter } from "../../product-service/src/presentation/http-filter";
import {
  HttpErrorFilter as InventoryFilter,
  STOCK_ERROR_STATUS,
} from "../../inventory-service/src/presentation/http-filter";
import { StockError } from "../../inventory-service/src/domain/stock";

function capture(
  filter: BffFilter | ProductFilter | InventoryFilter,
  error: Error,
) {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ headers: {} }),
      getResponse: () => ({ setHeader: vi.fn(), status }),
    }),
  } as unknown as ArgumentsHost;
  filter.catch(error, host);
  return { status: status.mock.calls[0][0], body: json.mock.calls[0][0] };
}

describe.each([
  ["BFF", new BffFilter()],
  ["Product", new ProductFilter()],
  ["Inventory", new InventoryFilter()],
] as const)("%s HTTP status preservation", (_name, filter) => {
  it.each([400, 404, 405, 413, 503])(
    "preserves framework status %s",
    (status) => {
      expect(
        capture(filter, new HttpException("Request failed", status)).status,
      ).toBe(status);
    },
  );
  it("preserves body-parser failures without exposing input", () => {
    const oversized = capture(
      filter,
      Object.assign(new Error("private payload"), {
        type: "entity.too.large",
        status: 413,
      }),
    );
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.message).toBe("Request body is too large.");
    const malformed = capture(
      filter,
      Object.assign(new SyntaxError("private payload"), {
        type: "entity.parse.failed",
        status: 400,
      }),
    );
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.message).toBe("Malformed JSON body.");
    expect(
      capture(filter, Object.assign(new Error("Unexpected"), { status: 413 }))
        .status,
    ).toBe(500);
  });
});

it("maps every inventory domain error to its declared status", () => {
  for (const [code, status] of Object.entries(STOCK_ERROR_STATUS)) {
    const result = capture(
      new InventoryFilter(),
      new StockError(code as StockError["code"], "Rejected"),
    );
    expect(result.status).toBe(status);
    expect(result.body.error.code).toBe(code);
  }
});
