import type { ApiError } from "@stockflow/contracts";

export class UpstreamError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class HttpUpstream {
  constructor(private readonly baseUrl: string) {}
  async request<T>(
    path: string,
    options: {
      method?: "GET" | "POST";
      body?: unknown;
      idempotencyKey?: string;
      requestId?: string;
    } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      "X-Request-ID": options.requestId ?? crypto.randomUUID(),
    };
    if (options.body !== undefined)
      headers["Content-Type"] = "application/json";
    if (options.idempotencyKey)
      headers["Idempotency-Key"] = options.idempotencyKey;
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new UpstreamError(
        502,
        "UPSTREAM_UNAVAILABLE",
        "Required service unavailable.",
      );
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new UpstreamError(
        502,
        "UPSTREAM_UNAVAILABLE",
        "Invalid upstream response.",
      );
    }
    if (!response.ok) {
      const envelope = data as Partial<ApiError>;
      const known = envelope?.error;
      if (
        known &&
        typeof known.code === "string" &&
        typeof known.message === "string" &&
        [400, 404, 409, 422, 503].includes(response.status)
      )
        throw new UpstreamError(response.status, known.code, known.message);
      throw new UpstreamError(
        502,
        "UPSTREAM_UNAVAILABLE",
        "Required service unavailable.",
      );
    }
    return data as T;
  }
  health(): Promise<unknown> {
    return this.request("/health/ready");
  }
}
