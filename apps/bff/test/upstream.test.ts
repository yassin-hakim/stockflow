import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpUpstream, UpstreamError } from "../src/upstream";

afterEach(() => vi.unstubAllGlobals());

describe("BFF upstream client", () => {
  it("forwards a stock command and key once even when the request times out", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("timeout");
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new HttpUpstream("http://localhost:3002");
    await expect(
      client.request("/inventory/p/add", {
        method: "POST",
        body: { quantity: 1, reason: "Delivery" },
        idempotencyKey: "key",
        requestId: "request",
      }),
    ).rejects.toMatchObject({ status: 502, code: "UPSTREAM_UNAVAILABLE" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].headers["Idempotency-Key"]).toBe("key");
    expect(fetchMock.mock.calls[0][1].headers["X-Request-ID"]).toBe("request");
  });
  it("preserves stable service errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: "INSUFFICIENT_STOCK",
                message: "Too much.",
                requestId: "request",
              },
            }),
            { status: 409, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    await expect(
      new HttpUpstream("http://localhost:3002").request("/inventory/p/remove"),
    ).rejects.toMatchObject({
      status: 409,
      code: "INSUFFICIENT_STOCK",
    } satisfies Partial<UpstreamError>);
  });
});
