import { AsyncLocalStorage } from "node:async_hooks";
/** Infrastructure-only correlation context; never participates in command identity. */
export const inventoryRequestContext = new AsyncLocalStorage<{
  requestId: string;
}>();
export function correlationHeaders(): Record<string, string> {
  const request = inventoryRequestContext.getStore();
  return request ? { "X-Request-ID": request.requestId } : {};
}
