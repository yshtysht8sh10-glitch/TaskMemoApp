// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { spec } from '../textFormat/specTestSupport';
import { TextEditScreen, TextViewScreen } from './TextWorkspace';
import { createTextSession, serializeText } from '../textFormat/session';
import { planTextEdit } from '../textFormat/planner';
import { parseText } from '../textFormat/parser';
import { renderTextView, type TextViewSnapshot } from '../textFormat/presentation';
import type { VersionedNode } from '../sync/types';
import * as Clipboard from 'expo-clipboard';
import ts from 'typescript';
const state = vi.hoisted(() => ({ platform: 'web', inputs: [] as Record<string, unknown>[], palette: null as Record<string, string> | null }));
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn(async () => true) }));
vi.mock('../theme/theme', () => ({ useAppTheme: () => ({ colors: state.palette ?? { background: '#fff', surface: '#eee', surfaceAlt: '#ddd', text: '#111', textSecondary: '#666', accent: '#008', accentSoft: '#ccf', danger: '#b22', border: '#777', memoText: '#443', memoBackground: '#ffc', ideaText: '#434', ideaBackground: '#fcf' } }) }));
vi.mock('react-native', async () => {
  const React = await import('react');
  const flatten = (style: unknown): Record<string, unknown> => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : (style || {}) as Record<string, unknown>;
  const box = (tag: string) => function Box(p: Record<string, unknown>) {
    return React.createElement(tag, { style: flatten(p.style), 'data-role': p.accessibilityRole, 'aria-checked': (p.accessibilityState as { checked?: boolean })?.checked,
      onClick: p.onPress, disabled: p.disabled }, p.children as React.ReactNode);
  };
  return { Platform: { get OS() { return state.platform; } }, StyleSheet: { flatten, create: (s: unknown) => s },
    View: box('div'), Text: box('span'), Modal: box('section'), ScrollView: box('div'), Pressable: box('button'),
    TextInput: React.forwardRef(function Input(p: Record<string, unknown>, ref) {
      state.inputs.push(p); React.useImperativeHandle(ref, () => ({ focus: () => {} }));
      return React.createElement('textarea', { style: flatten(p.style), readOnly: p.editable === false, 'aria-label': p.accessibilityLabel, value: p.value ?? '', onChange: () => {} });
    }) };
});
vi.mock('react-native-safe-area-context', async () => ({ SafeAreaView: (await import('react-native')).View }));

let root: Root, host: HTMLDivElement;
const context = { now: '2026-10-06T03:00:00.000Z', timeZone: 'Asia/Tokyo' };
const current: VersionedNode[] = [{ value: { id: 'task-id', type: 'memo', title: 'Title', body: 'Body', parentId: null, sortKey: 'a0', memoType: 'task', status: 'active', dueAt: null, duePreset: 'none', repeatRule: null, createdAt: context.now, updatedAt: context.now, deletedAt: null }, revision: 1, lastOpId: 'op', lastDeviceId: 'd', lastLocalSeq: 1, operationType: 'create' }];
const session = () => createTextSession(current, { ...context, id: 'ui', scope: 'local', view: 'tree', systemRegions: true });
const props = () => ({ session: session(), excluded: 2, prepare: vi.fn((s, text) => planTextEdit(s, text, current)), commit: vi.fn(async () => {}), discard: vi.fn(), onClose: vi.fn() });
const text = () => host.textContent ?? '';
const button = (label: string) => {
  const target = Array.from(host.querySelectorAll('button')).find(b => b.textContent === label);
  if (!target) throw new Error(`Missing button ${label}: ${text()}`); return target;
};
const click = async (label: string) => { await act(async () => { button(label).click(); }); };
const inputProps = () => state.inputs[state.inputs.length - 1] as { onChangeText: (value: string) => void; onSelectionChange: (e: { nativeEvent: { selection: { start: number } } }) => void };
const input = async (value: string) => { await act(async () => inputProps().onChangeText(value)); };
const validate = async () => { await act(async () => { vi.advanceTimersByTime(180); }); };
const mount = async (element: React.ReactNode) => { await act(async () => root.render(element)); };
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); state.inputs = []; state.platform = 'web'; state.palette = null;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
const source = () => readFileSync('src/components/TextWorkspace.tsx', 'utf8');
it('Issue 92 uses native vertical textarea resize without a height cap or replacing the editor during validation', async () => {
  const p = props(); await mount(<TextEditScreen {...p} />);
  const editor = host.querySelector('textarea')!;
  expect(editor.style.resize).toBe('vertical'); expect(editor.style.overflow).toBe('scroll');
  expect(editor.style.minHeight).toBe('260px'); expect(editor.style.maxHeight).toBe('');
  expect(Number.parseFloat(editor.style.fontSize)).toBeGreaterThanOrEqual(16);
  const draft = serializeText(p.session).replace('Title', 'Changed'); await input(draft);
  editor.style.height = '1200px'; editor.focus(); editor.setSelectionRange(3, 8);
  await validate();
  expect(host.querySelector('textarea')).toBe(editor); expect(editor.style.height).toBe('1200px');
  expect(editor.value).toBe(draft); expect(document.activeElement).toBe(editor);
  expect([editor.selectionStart, editor.selectionEnd]).toEqual([3, 8]);
  expect(p.commit).not.toHaveBeenCalled(); expect(text()).toContain('Changed');
});
it('Issue 92 leaves native editor resize styles unchanged', async () => {
  state.platform = 'ios'; await mount(<TextEditScreen {...props()} />);
  expect(host.querySelector('textarea')!.style.resize).toBe('');
});
spec('TW-UI-001', () => {
  for (const path of ['src/components/NodeTree.tsx', 'src/components/DeadlineView.tsx']) {
    const s = readFileSync(path, 'utf8'); expect(s).toContain('テキスト編集'); expect(s).toContain('テキストView');
  }
  const s = readFileSync('src/app/index.tsx', 'utf8'); expect(s).toContain('<TextEditScreen'); expect(s).toContain('<TextViewScreen');
});
spec('TW-UI-002', async () => { const p = props(); await mount(<TextEditScreen {...p} />); expect(host.querySelector('textarea')!.value).toBe(serializeText(p.session)); });
spec('TW-UI-003', async () => { await mount(<TextEditScreen {...props()} />); for (const col of ['ref', 'type', 'title', 'due', 'completion', 'body', 'routine']) expect(text()).toContain(col); expect(text()).toContain('下線'); });
spec('TW-UI-004', async () => { await mount(<TextEditScreen {...props()} />); for (const name of ['@root', '@routine']) { const span = Array.from(host.querySelectorAll('span')).find(el => el.textContent?.includes('▣ システム領域') && el.textContent.includes(name))!; expect(span).toBeTruthy(); expect(span.style.fontWeight).toBe('800'); expect(span.parentElement!.style.borderWidth).toBe('2px'); } });
spec('TW-UI-005', async () => {
  const p = props(); await mount(<TextEditScreen {...p} />); await input(serializeText(p.session).replace('Title', 'changed')); await validate();
  const cell = Array.from(host.querySelectorAll('span')).find(el => el.textContent === 'changed')!;
  expect(cell.style.color).toBe('rgb(187, 34, 34)'); expect(cell.style.textDecorationLine).toBe('underline');
});
spec('TW-UI-006', async () => {
  const p = props(); await mount(<TextEditScreen {...p} />); await input(serializeText(p.session).replace('期限なし', '月末あたり')); await validate();
  expect(text()).toContain('2行 4列'); expect(text()).toContain('⚠'); expect(text()).toContain('期限');
  const errorLine = Array.from(host.querySelectorAll('div')).find(el => el.style.borderColor === 'rgb(187, 34, 34)' && el.textContent?.includes('due') && el.style.borderWidth === '1px')!;
  expect(errorLine).toBeTruthy(); expect(errorLine.style.backgroundColor).toBe('rgb(221, 221, 221)');
});
spec('TW-UI-007', async () => {
  const p = props(); await mount(<TextEditScreen {...p} />); await input('@root\n  Task | New\n@routine'); await validate();
  expect(text()).toContain('＋新規'); expect(text()).toContain('− 削除予定 @n1: Title');
});
spec('TW-UI-008', async () => {
  const p = props(); await mount(<TextEditScreen {...p} />); const draft = serializeText(p.session).replace('期限なし', '10/'); await input(draft);
  expect(text()).not.toContain('2行 4列'); await validate(); expect(text()).toContain('2行 4列'); expect(host.querySelector('textarea')!.value).toBe(draft); expect(p.commit).not.toHaveBeenCalled();
});
spec('TW-UI-009', async () => {
  const p = props(); await mount(<TextEditScreen {...p} />); const draft = serializeText(p.session).replace('期限なし', '10/'); await input(draft); await click('保存');
  expect(p.prepare).toHaveBeenLastCalledWith(p.session, draft); expect(p.commit).not.toHaveBeenCalled(); expect(p.onClose).not.toHaveBeenCalled();
});
spec('TW-UI-010', async () => {
  const p = props(); p.commit.mockRejectedValueOnce(new Error('storage failed')); await mount(<TextEditScreen {...p} />); const draft = serializeText(p.session).replace('Title', 'Changed'); await input(draft); await click('保存');
  expect(text()).toContain('storage failed'); expect(host.querySelector('textarea')!.value).toBe(draft); expect(p.onClose).not.toHaveBeenCalled();
});
spec('TW-UI-011', async () => {
  const p = props(); let finish!: () => void; p.commit.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await mount(<TextEditScreen {...p} />); await click('保存'); expect(p.onClose).not.toHaveBeenCalled(); expect(text()).toContain('保存中');
  await act(async () => { finish(); }); expect(p.onClose).toHaveBeenCalledOnce();
});
spec('TW-UI-012', async () => {
  const p = props(); await mount(<TextEditScreen {...p} />); await input('@root\n@routine'); await click('保存'); expect(host.querySelector('textarea')!.readOnly).toBe(true);
  // A late input event/changed document must never execute the reviewed plan.
  await input('@root\n  @n1 | Task | Changed\n@routine'); await click('確認して保存'); expect(p.commit).not.toHaveBeenCalled(); expect(text()).toContain('確認後に入力が変わりました');
});
const snapshot: TextViewSnapshot = { view: 'list', rows: [{ title: 'Today', depth: 0, details: {} }, { title: 'A', depth: 1, details: { body: 'Body', due: '4/25', type: 'Task', completion: '未完了', category: '仕事', routine: 'なし' } }] };
spec('TW-UI-013', async () => {
  await mount(<TextViewScreen snapshot={snapshot} onClose={vi.fn()} />); expect(host.querySelector('textarea')!.readOnly).toBe(true);
  const checks = host.querySelectorAll('[data-role="checkbox"]'); expect(checks).toHaveLength(7); for (const check of checks) expect(check.getAttribute('aria-checked')).toBe('false');
  expect(host.querySelector('textarea')!.value).toBe('Today\n  A');
});
spec('TW-UI-014', async () => { await mount(<TextViewScreen snapshot={snapshot} onClose={vi.fn()} />); await click('☐ 自由入力（本文）'); await click('☐ 項目名を表示'); await click('コピー'); expect(Clipboard.setStringAsync).toHaveBeenLastCalledWith(renderTextView(snapshot, ['body'], true)); expect(text()).toContain('コピーしました'); });
spec('TW-UI-015', async () => { await mount(<TextViewScreen snapshot={snapshot} onClose={vi.fn()} />); for (const failure of [false, new Error('denied')]) { if (failure instanceof Error) vi.mocked(Clipboard.setStringAsync).mockRejectedValueOnce(failure); else vi.mocked(Clipboard.setStringAsync).mockResolvedValueOnce(false); await click('コピー'); expect(text()).toContain('本文を選択してコピー'); expect(text()).not.toContain('コピーしました'); } });
spec('TW-UI-016', async () => {
  const add = vi.spyOn(window, 'addEventListener'), remove = vi.spyOn(window, 'removeEventListener'), p = props(); await mount(<TextEditScreen {...p} />);
  expect(add.mock.calls.some(([type]) => type === 'beforeunload')).toBe(false); await input(serializeText(p.session).replace('Title', 'Dirty'));
  const call = add.mock.calls.find(([type]) => type === 'beforeunload')!; expect(call).toBeTruthy(); const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  await input(serializeText(p.session)); expect(remove).toHaveBeenCalledWith('beforeunload', call[1]); add.mockRestore(); remove.mockRestore();
});
spec('TW-UI-017', () => { const s = source(); expect(s).not.toMatch(/from ['"][^'"]*(?:firebase|indexedDb|applicationStorage|async-storage)/i); expect(s).toContain('const plan = prepare(session, text)'); expect(s).toContain('await commit(plan'); expect(s).toContain('discard(session)'); });
spec('TW-UI-018', async () => {
  const p = props(); await mount(<TextEditScreen {...p} />); const original = serializeText(p.session), row = parseText(original, 'tree').rows[0], cell = row.cells[3];
  await act(async () => inputProps().onSelectionChange({ nativeEvent: { selection: { start: original.indexOf('\n') + cell.start } } }));
  await click('明日'); expect(host.querySelector('textarea')!.value).toBe(original.replace('期限なし', '明日'));
});
spec('TW-UI-019', async () => {
  await mount(<TextEditScreen {...props()} />); expect(host.querySelector('textarea')!.style.fontSize).toBe('16px');
  state.platform = 'android'; await mount(<TextEditScreen {...props()} />); expect(host.querySelector('textarea')!.style.fontSize).toBe('14px');
});
spec('TW-UI-020', () => {
  for (const file of ['src/app/+html.tsx', 'public/form-typography.css', 'src/components/TextWorkspace.tsx']) expect(readFileSync(file, 'utf8')).not.toMatch(/user-scalable\s*[:=]\s*(?:no|0)|maximum-scale\s*[:=]\s*1(?:\D|$)|scale\(0\./);
});
spec('TW-UI-021', async () => {
  const p = props(); await mount(<TextEditScreen {...p} />); await input(serializeText(p.session).replace('期限なし', '10/')); await click('閉じる');
  expect(text()).toContain('編集を続ける'); expect(text()).toContain('変更を破棄して閉じる'); expect(text()).not.toContain('保存して閉じる');
  await click('変更を破棄して閉じる'); expect(p.discard).toHaveBeenCalledWith(p.session); expect(p.onClose).toHaveBeenCalledOnce(); expect(p.commit).not.toHaveBeenCalled();
});
spec('TW-UI-022', async () => {
  const p = props(); await mount(<TextEditScreen {...p} />); const draft = serializeText(p.session).replace('Title', 'Changed'); await input(draft); await click('閉じる');
  expect(text()).toContain('編集を続ける'); expect(text()).toContain('変更を破棄して閉じる'); await click('保存して閉じる'); expect(p.prepare).toHaveBeenLastCalledWith(p.session, draft); expect(p.commit).toHaveBeenCalledOnce(); expect(p.onClose).toHaveBeenCalledOnce();
});
spec('TW-UI-023', async () => { const p = props(); await mount(<TextEditScreen {...p} />); await click('閉じる'); expect(p.onClose).toHaveBeenCalledOnce(); expect(p.discard).toHaveBeenCalledWith(p.session); expect(p.prepare).not.toHaveBeenCalled(); expect(p.commit).not.toHaveBeenCalled(); });
spec('TW-UI-024', async () => {
  const p = props(); await mount(<TextEditScreen {...p} />); const draft = serializeText(p.session).replace('期限なし', '10/'); await input(draft); await click('閉じる'); await click('編集を続ける');
  expect(host.querySelector('textarea')!.value).toBe(draft); expect(host.querySelector('textarea')!.readOnly).toBe(false); expect(p.discard).not.toHaveBeenCalled(); expect(p.commit).not.toHaveBeenCalled(); expect(p.onClose).not.toHaveBeenCalled();
});
spec('TW-UI-025', async () => { const p = props(); await mount(<TextEditScreen {...p} />); await input('@root\n@routine'); await click('保存'); expect(text()).toContain('Title'); await click('編集を続ける'); expect(p.commit).not.toHaveBeenCalled(); expect(host.querySelector('textarea')!.readOnly).toBe(false); });
spec('TW-UI-026', async () => {
  // Read the real static palette without importing its storage-owning provider.
  const theme = ts.createSourceFile('theme.tsx', readFileSync('src/theme/theme.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const palettes: Record<string, Record<string, string>> = {};
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(theme) === 'THEME_COLORS' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      for (const mode of node.initializer.properties) if (ts.isPropertyAssignment(mode) && ts.isObjectLiteralExpression(mode.initializer)) {
        palettes[mode.name.getText(theme)] = Object.fromEntries(mode.initializer.properties.filter(ts.isPropertyAssignment).map(property => {
          if (!ts.isStringLiteral(property.initializer)) throw new Error('Palette must be a static string');
          return [property.name.getText(theme), property.initializer.text];
        }));
      }
    }
    ts.forEachChild(node, visit);
  }; visit(theme); expect(Object.keys(palettes)).toEqual(['light', 'dark']);
  const css = (color: string) => { const span = document.createElement('span'); span.style.color = color; return span.style.color; };
  for (const mode of ['light', 'dark']) {
    state.palette = palettes[mode]; await mount(<TextEditScreen {...props()} />);
    expect(host.querySelector('textarea')!.style.color).toBe(css(palettes[mode].text));
    const region = Array.from(host.querySelectorAll('span')).find(span => span.textContent?.includes('▣ システム領域 @root'))!;
    expect(region.parentElement!.style.backgroundColor).toBe(css(palettes[mode].accentSoft));
    expect(region.parentElement!.style.borderColor).toBe(css(palettes[mode].accent));
    expect(region.textContent).toContain('システム領域');
  }
});
