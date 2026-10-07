/** V1 dates normalize into the existing millisecond-resolution V2 contract.
 * Never truncate sub-millisecond timestamps or infer alternative object shapes. */
export function decodeLegacyDate(value: unknown, field: string): string | null | undefined {
  const invalid = () => new Error(`V1日時 ${field} が不正です。`);
  if (value == null) return value as null | undefined;
  if (typeof value === 'string') {
    if (!Number.isFinite(Date.parse(value))) throw invalid();
    return value; // Preserve existing supported strings exactly.
  }
  if (typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw invalid();
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 3 || !['type', 'seconds', 'nanoseconds'].every(key => keys.includes(key)) ||
      record.type !== 'firestore/timestamp/1.0' ||
      typeof record.seconds !== 'number' || !Number.isInteger(record.seconds) ||
      record.seconds < -62135596800 || record.seconds > 253402300799 ||
      typeof record.nanoseconds !== 'number' || !Number.isInteger(record.nanoseconds) ||
      record.nanoseconds < 0 || record.nanoseconds > 999999999 || record.nanoseconds % 1000000 !== 0) throw invalid();
  const milliseconds = record.seconds * 1000 + record.nanoseconds / 1000000;
  const date = new Date(milliseconds);
  if (!Number.isSafeInteger(milliseconds) || date.getTime() !== milliseconds) throw invalid();
  return date.toISOString();
}
