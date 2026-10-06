/** Parse decimal text with integer arithmetic; no binary-float currency rounding. */
export function priceMinor(value: string): number | null {
  const text = value.trim();
  if (text.length > 40 || !/^[0-9]+(?:\.[0-9]{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}
export function priceText(minor: number): string {
  const value = BigInt(minor);
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}
export function money(minor: number, currency: string): string { return `${currency} ${priceText(minor)}`; }
