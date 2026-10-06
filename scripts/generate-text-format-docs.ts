import { writeFileSync, readFileSync } from 'node:fs';
import { COMPLETION_VALUES, RELATIVE_DUE_VALUES, TEXT_COLUMNS, TEXT_ERRORS, TEXT_TYPES, ROUTINE_FREQUENCIES } from '../src/textFormat/syntax';
import { SYSTEM_REGIONS, ROUTINE_ALIASES } from '../src/textFormat/syntax';

export function textFormatReference() {
  return '# Text Format許可値（生成物）\n\n' +
    '一次情報：`src/textFormat/syntax.ts`。再生成：`npx tsx scripts/generate-text-format-docs.ts`。\n\n' +
    `列：${TEXT_COLUMNS.join(' | ')}\n\n種別：${TEXT_TYPES.join(' / ')}\n\n完了：${COMPLETION_VALUES.join(' / ')}\n\n` +
    `相対期限：${RELATIVE_DUE_VALUES.join(' / ')}\n\nRoutine frequency：${ROUTINE_FREQUENCIES.join(' / ')}\n\n` +
    `システム予約語（Nodeではない）：${SYSTEM_REGIONS.join(' / ')}\n\nRoutine短縮形：${Object.keys(ROUTINE_ALIASES).join(' / ')}\n\n` +
    '| code | 意味・修正方法 |\n|---|---|\n' + Object.entries(TEXT_ERRORS).map(([code, message]) => `| ${code} | ${message} |`).join('\n') + '\n';
}
const expected = textFormatReference();
if (process.argv.includes('--check')) {
  if (readFileSync('docs/TEXT_FORMAT_REFERENCE.md', 'utf8') !== expected) throw new Error('Text Format documentation is stale');
} else writeFileSync('docs/TEXT_FORMAT_REFERENCE.md', expected);
