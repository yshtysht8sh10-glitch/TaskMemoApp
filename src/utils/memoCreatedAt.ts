/** Display only: never manufacture a creation time from update/deadline metadata. */
export function memoCreatedAtLabel(value: unknown, routineDefinition = false) {
  const prefix = routineDefinition ? '定義の作成日時' : '作成日時';
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return `${prefix}: 不明`;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${prefix}: ${value.getFullYear()}/${pad(value.getMonth() + 1)}/${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
}
