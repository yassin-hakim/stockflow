export const QUANTITY_SCALE = 1000;
export const MAX_QUANTITY = 1_000_000_000;
export const MAX_QUANTITY_MILLIS = MAX_QUANTITY * QUANTITY_SCALE;

/** Validate the parsed numeric value by round-tripping through integer thousandths.
 * Multiplication can drift at large magnitudes even for valid three-place values.
 */
export function quantityMillis(
  value: unknown,
  allowZero = false,
): number | null {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > MAX_QUANTITY
  )
    return null;
  const millis = Math.round(value * QUANTITY_SCALE);
  if (
    !Number.isSafeInteger(millis) ||
    (!allowZero && millis === 0) ||
    millis / QUANTITY_SCALE !== value
  )
    return null;
  return millis;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Express body-parser failures are ordinary errors, not Nest HttpExceptions. */
export function requestBodyFailure(
  error: unknown,
): { status: number; message: string } | null {
  if (!error || typeof error !== "object" || !("type" in error)) return null;
  if (error.type === "entity.too.large")
    return { status: 413, message: "Request body is too large." };
  if (error.type === "entity.parse.failed")
    return { status: 400, message: "Malformed JSON body." };
  return null;
}
