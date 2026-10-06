export function requiredHttpUrl(
  name: "PRODUCT_SERVICE_URL" | "INVENTORY_SERVICE_URL" | 'SALES_SERVICE_URL',
): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error(`Invalid ${name}.`);
  return value.replace(/\/$/, "");
}
