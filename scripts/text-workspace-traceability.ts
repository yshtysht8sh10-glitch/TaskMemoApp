import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import catalog from '../docs/text-workspace-specs.json';

export type Spec = { id: string; requirement: string; level: string; coverage: string; status: string; file?: string; test?: string; reason?: string; steps?: string };
export type Registration = { id: string; file: string; title?: string; disabled: boolean };
export function registrations(): Registration[] {
  const result: Registration[] = [];
  const walk = (dir: string) => { for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.test\.tsx?$/.test(entry.name)) {
      const file = relative('.', path).replaceAll('\\', '/');
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          const callee = node.expression.getText(source), first = node.arguments[0].text;
          // Spec registrations and ordinary it / it.each literal titles; comments do not count.
          const match = callee === 'spec' ? /^(TW-[A-Z]+-\d{3})$/.exec(first) : /^(?:it|test)(?:\.|\()/.test(callee + '(') ? /^\[(TW-[A-Z]+-\d{3})\]/.exec(first) : null;
          if (match) result.push({ id: match[1], file, title: callee === 'spec' ? undefined : first,
            disabled: /\.(skip|todo)\b/.test(callee) || /describe\.skip/.test(source.text) });
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  } }; walk('src'); return result;
}
export function traceErrors(rows: readonly Spec[], tests: readonly Registration[]): string[] {
  const errors: string[] = [], ids = new Set<string>();
  for (const row of rows) {
    if (!/^TW-[A-Z]+-\d{3}$/.test(row.id) || ids.has(row.id)) errors.push(`Invalid/duplicate Spec ID ${row.id}`);
    ids.add(row.id);
    if (!row.requirement.trim()) errors.push(`Empty requirement ${row.id}`);
    if (row.status === 'device-only') {
      if (!row.reason?.trim() || !row.steps?.trim() || row.file || row.test) errors.push(`Missing device rationale/steps ${row.id}`);
      continue;
    }
    if (row.status !== 'automated') errors.push(`Uncovered Spec ID ${row.id}: ${row.status}`);
    const mapped = tests.filter(test => test.id === row.id);
    if (mapped.length !== 1) errors.push(`Expected exactly one direct test registration for ${row.id}, got ${mapped.length}`);
    else if (mapped[0].file !== row.file || mapped[0].disabled || !row.test?.startsWith(`[${row.id}] `) || mapped[0].title && mapped[0].title !== row.test) errors.push(`Test mapping mismatch/disabled ${row.id}`);
  }
  for (const test of tests) if (!ids.has(test.id)) errors.push(`Test has unknown Spec ID ${test.id}`);
  return errors;
}
const escape = (s: string) => s.replaceAll('|', '\\|').replaceAll('\n', '<br>');
export function matrix(rows: readonly Spec[] = catalog): string {
  const automatic = rows.filter(s => s.status !== 'device-only');
  return '# Text Workspace traceability matrix\n\n' +
    '一次仕様: [Issue #59](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/issues/59)本文・[最新方針コメント](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/issues/59#issuecomment-6016399255)、TEXT_WORKSPACE.md / TEXT_FORMAT.md / TEXT_FORMAT_DEVELOPMENT.md / TEXT_PHASE7_ACCEPTANCE.md。\n\n' +
    '`text-workspace-specs.json`が安定Spec IDの台帳。IDは再利用・改番しない。各自動仕様は1つの直接登録へ対応し、同じ広いテストを複数IDへ重複計上しない。parameterized testの各例は同じ契約の入力variantsとして扱う。テスト名にSpec IDを含む。\n\n' +
    `全${rows.length}仕様: 自動${automatic.length}、実機のみ${rows.length - automatic.length}。初期棚卸しは既存74 / 不足84 / 実機5。その後の追加仕様もnewとして記録。\n\n` +
    'status「automated」はsuiteに必須の登録があることを示し、無条件のPASSではない。実行結果は下記結果文書に分離。source-contractは配線/禁止依存の構造検査であり、ブラウザ操作の証明とは区別する。componentはReact DOM/jsdom＋React Native primitive/Clipboard mockで実コンポーネントのhook/eventを検証し、OS/UI toolkit固有動作は保証しない。\n\n' +
    '更新: `npx tsx scripts/text-workspace-traceability.ts`。照合: `npx tsx scripts/text-workspace-traceability.ts --check`。full suiteにtraceability.test.tsを含み、未対応/欠落/重複/skip登録/文書不一致を失敗させる。実行後JSON照合: `--results <vitest-json>`。Spec IDを持つ全入力variantsがpassedでなければ失敗する。\n\n' +
    '| Spec ID | 原子的仕様 | test file / test name | level | status | 初期対応 |\n|---|---|---|---|---|---|\n' + rows.map(row => `| ${row.id} | ${escape(row.requirement)} | ${row.file ? `[${row.file}](../${row.file})<br>${escape(row.test!)}` : '実機のみ'} | ${row.level} | ${row.status} | ${row.coverage} |`).join('\n') +
    '\n\n## 実機のみの理由と最小手順\n\n' + rows.filter(row => row.status === 'device-only').map(row => `- **${row.id}**: ${row.reason}。${row.steps}`).join('\n') +
    '\n\n## 不足テストとcross-feature invariant\n\n不足一覧は初期coverage=newの各行。専用pure/APIテスト、component eventテストとして追加。TW-INV-001〜003は手書きMemo fixtureだけに依存せず、通常UIと同じcreate/update/complete/duplicate/move/softDelete CommandとRoutineフォーム初期値・rule builderを使う。Category階層、同名Task、Idea、過去相対preset、絶対秒/ミリ秒、本文escape、完了Task、日/週/月/年Routineと当日実績を含む。通常Tree adapter/list projection→serialize→strict prepareで0 errors/0 changes/0 deletions。再起動・無編集commitもstorage/History/Outbox不変を検証。実EditorModalでの作成操作そのものの実機検証とは分ける。\n\n' +
    '本番由来fixtureは取得済み匿名化ファイルだけを使用。本番への接続・更新・deployなし。suiteはIssue Closeしない。実行結果: [TEXT_WORKSPACE_TRACEABILITY_RESULTS.md](TEXT_WORKSPACE_TRACEABILITY_RESULTS.md)。\n';
}
export function resultErrors(rows: readonly Spec[], report: { testResults: { name: string; assertionResults: { fullName: string; status: string }[] }[] }): string[] {
  const errors: string[] = [];
  for (const row of rows.filter(s => s.status !== 'device-only')) {
    const assertions = report.testResults.filter(file => file.name.replaceAll('\\', '/').endsWith('/' + row.file))
      .flatMap(file => file.assertionResults).filter(test => test.fullName.includes(`[${row.id}] `));
    if (!assertions.length || assertions.some(test => test.status !== 'passed')) errors.push(`Unexecuted/failed/skipped Spec ID ${row.id}`);
  }
  return errors;
}
if (process.argv[1] && fileURLToPath(import.meta.url).replaceAll('\\', '/') === process.argv[1].replaceAll('\\', '/')) {
  const errors = traceErrors(catalog, registrations());
  if (errors.length) throw new Error(errors.join('\n'));
  const path = 'docs/TEXT_WORKSPACE_TRACEABILITY.md';
  if (process.argv.includes('--check')) { if (readFileSync(path, 'utf8') !== matrix()) throw new Error('Traceability matrix is stale'); }
  else if (!process.argv.includes('--results')) writeFileSync(path, matrix());
  const index = process.argv.indexOf('--results');
  if (index >= 0) { const errors = resultErrors(catalog, JSON.parse(readFileSync(process.argv[index + 1], 'utf8'))); if (errors.length) throw new Error(errors.join('\n')); }
  console.log(`Traceability: ${catalog.length} Spec IDs verified`);
}
