import { canonical } from '../textFormat/syntax';
export type ConflictField = { name: string; local: unknown; account: unknown };
export function compareConflictFields(local: unknown, account: unknown) {
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const fields: ConflictField[] = object(local) && object(account)
    ? [...new Set([...Object.keys(local), ...Object.keys(account)])].map(name => ({ name, local: local[name], account: account[name] }))
    : [{ name: '内容', local, account }];
  const equal = (f: ConflictField) => canonical(f.local) === canonical(f.account);
  return { changed: fields.filter(f => !equal(f)), same: fields.filter(equal) };
}
export function displayConflictValue(value: unknown): string {
  if (value === undefined) return '未設定（項目なし）';
  if (typeof value === 'string') return value || '空文字';
  return JSON.stringify(value, null, 2);
}
export type ConflictSegment = { text: string; changed: boolean };
/** Linear prefix/suffix comparison; no quadratic long-body diff or data normalization. */
export function conflictTextSegments(local: string, account: string) {
  const a = Array.from(local), b = Array.from(account); let start = 0, end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (end < a.length - start && end < b.length - start && a[a.length - end - 1] === b[b.length - end - 1]) end++;
  const segments = (value: string[]) => [
    { text: value.slice(0, start).join(''), changed: false },
    { text: value.slice(start, value.length - end).join(''), changed: value.length - end > start },
    { text: end ? value.slice(-end).join('') : '', changed: false },
  ];
  return { local: segments(a), account: segments(b) };
}
