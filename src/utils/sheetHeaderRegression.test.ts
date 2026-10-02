import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';

const source = readFileSync('src/app/index.tsx', 'utf8');
const file = ts.createSourceFile('index.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
it.each(['EditorModal', 'Sheet'])('%s has a dismiss header outside its scroll content', name => {
  const fn = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!;
  const headers: ts.Node[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'SheetDismissHeader') headers.push(node);
    ts.forEachChild(node, visit);
  }
  visit(fn);
  expect(headers).toHaveLength(1);
  let parent = headers[0].parent;
  while (parent !== fn) {
    if (ts.isJsxElement(parent)) expect(parent.openingElement.tagName.getText(file)).not.toBe('ScrollView');
    parent = parent.parent;
  }
});
it('Quick Add relies on keyboard confirmation and retains cancellation', () => {
  const quick = readFileSync('src/components/QuickTitleEditor.tsx', 'utf8');
  expect(quick).not.toContain('accessibilityLabel="タイトル編集を確定"');
  expect(quick).toContain('accessibilityLabel="タイトル編集をキャンセル"');
  expect(quick).toContain('onSubmitEditing={() => close(true)}');
  expect(quick).toContain('onBlur=');
});
it('the dedicated header owns touch gestures without browser scrolling', () => {
  const header = readFileSync('src/components/SheetDismissHeader.tsx', 'utf8');
  expect(header).toContain("touchAction: 'none'");
  expect(header).toContain('onStartShouldSetPanResponder: () => true');
  expect(header).toContain('onPanResponderTerminate: restore');
  expect(header).toContain('gesture.dy > Math.abs(gesture.dx)');
});
