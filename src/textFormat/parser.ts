import { TEXT_TYPES, errorAt, type TextCell, type TextDocument, type TextError, type TextRow } from './syntax';

export function encodeCell(value: string): string {
  return /[|\\\r\n\t"]/.test(value) || value !== value.trim() ? JSON.stringify(value) : value;
}
function decodeCell(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"')) {
    const decoded: unknown = JSON.parse(value);
    if (typeof decoded !== 'string') throw new Error('文字列セルが必要です。');
    return decoded;
  }
  return value.replace(/\\(.)/g, (_match, ch: string) => {
    const escapes: Record<string, string> = { '|': '|', '\\': '\\', n: '\n', r: '\r', t: '\t' };
    if (!(ch in escapes)) throw new Error('未定義escapeです。');
    return escapes[ch];
  });
}
export function splitCells(line: string): TextCell[] {
  const cells: TextCell[] = [];
  let start = 0, quoted = false, escaped = false;
  for (let i = 0; i <= line.length; i++) {
    const ch = line[i];
    if (escaped) { if (i === line.length) throw new Error('閉じていないescapeです。'); escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"' && (quoted || !line.slice(start, i).trim())) { quoted = !quoted; continue; }
    if (i === line.length || (ch === '|' && !quoted)) {
      if (quoted || escaped) throw new Error('閉じていない引用またはescapeです。');
      cells.push({ value: decodeCell(line.slice(start, i)), start: start + 1, end: i + 1 }); start = i + 1;
    }
  }
  if (quoted || escaped) throw new Error('閉じていない引用またはescapeです。');
  return cells;
}

export function parseText(text: string, view: 'tree' | 'list'): TextDocument {
  const rows: TextRow[] = [], errors: TextError[] = [];
  const stack: number[] = [];
  const regions: NonNullable<TextDocument['regions']> = [];
  let region: 'root' | 'routine' | undefined;
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    const lineNumber = index + 1;
    try {
      if (/^\s*\t/.test(line)) throw new Error('タブインデントは使用できません。');
      const indentation = /^ */.exec(line)![0].length;
      if (line.trim() === '@root' || line.trim() === '@routine') {
        if (view === 'list') throw new Error('一覧ではシステム領域による所属変更はできません。');
        if (indentation) throw new Error('システム領域は行頭に指定してください。');
        region = line.trim() === '@root' ? 'root' : 'routine';
        if (regions.some(r => r.name === region)) throw new Error('システム領域が重複しています。');
        regions.push({ line: lineNumber, name: region }); stack.length = 0; return;
      }
      if (view === 'tree' && indentation % 2) throw new Error('インデントは2スペース単位です。');
      const cells = splitCells(line);
      if ((TEXT_TYPES as readonly string[]).includes(cells[0]?.value)) cells.unshift({ value: '', start: indentation + 1, end: indentation + 1 });
      if (cells.length < 3 || cells.length > 7) throw new Error('3〜7列が必要です。');
      const ref = cells[0].value || null;
      if (ref && !/^@n[1-9]\d*$/.test(ref)) throw new Error('refは@n1形式です。');
      if (!(TEXT_TYPES as readonly string[]).includes(cells[1].value)) { errors.push(errorAt('type', lineNumber, 2)); return; }
      if (view === 'tree' && region && indentation < 2) throw new Error('システム領域内は2スペース以上でインデントしてください。');
      const depth = view === 'tree' ? indentation / 2 - (region ? 1 : 0) : 0;
      const parentRow = depth ? stack[depth - 1] : null;
      if (depth && (parentRow == null || rows[parentRow].type !== 'Category')) { errors.push(errorAt('hierarchy', lineNumber, 1)); return; }
      const row: TextRow = { line: lineNumber, depth, region, cells, ref, type: cells[1].value as TextRow['type'], title: cells[2].value, due: cells[3]?.value, completion: cells[4]?.value, body: cells[5]?.value, routine: cells[6]?.value, parentRow: parentRow ?? null };
      stack.length = depth + 1; stack[depth] = rows.length; rows.push(row);
    } catch (e) { errors.push(errorAt('syntax', lineNumber, 1, e instanceof Error ? e.message : '構文エラー')); }
  });
  return { rows, errors, regions };
}
