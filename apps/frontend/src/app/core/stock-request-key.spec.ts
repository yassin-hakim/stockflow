import { createStockRequestKey } from './stock-request-key';

describe('stock request keys on public HTTP', () => {
  it('creates independent UUID v4 keys when randomUUID is unavailable', () => {
    const httpCrypto = { getRandomValues: crypto.getRandomValues.bind(crypto) };
    const keys = Array.from({ length: 100 }, () => createStockRequestKey(httpCrypto));
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys)
      expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('uses the native UUID generator when available', () => {
    const key = '11111111-1111-4111-8111-111111111111';
    expect(createStockRequestKey({
      randomUUID: () => key,
      getRandomValues: crypto.getRandomValues.bind(crypto),
    })).toBe(key);
  });
});
