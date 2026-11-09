/** Deterministic JSON identity, NOT a cryptographic digest. Rejects lossy JSON inputs. */
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (Array.from(value).some(item => item === undefined)) throw new Error('Non-JSON array');
    return `[${value.map(canonical).join(',')}]`;
  }
  if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) {
    if (Object.getOwnPropertySymbols(value).length) throw new Error('Non-JSON object');
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  throw new Error('Only lossless plain JSON is accepted');
}
export const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
/** Locale-independent order; no clock or identifier ordering chooses a semantic winner. */
export const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
