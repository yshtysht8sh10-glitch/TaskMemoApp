import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import ts from 'typescript';
import type { ReactElement } from 'react';
// @ts-expect-error the installed renderer does not publish internal module types.
import WebScrollView from 'react-native-web/dist/exports/ScrollView/index.js';
// @ts-expect-error the installed renderer does not publish internal module types.
import TextInputState from 'react-native-web/dist/modules/TextInputState/index.js';
import { editorKeyboardDismissMode } from './editorScroll';

// Execute the actual generic Sheet prop, not a duplicate policy in the test.
function sheetMode(platform: string) {
  const source = ts.createSourceFile('index.tsx', readFileSync('src/app/index.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sheet = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'Sheet');
  let expression: string | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === 'keyboardDismissMode' && node.initializer && ts.isJsxExpression(node.initializer))
      expression = node.initializer.expression?.getText(source);
    ts.forEachChild(node, visit);
  };
  if (!sheet) throw new Error('Generic account Sheet missing');
  visit(sheet);
  if (!expression) throw new Error('Sheet keyboard policy missing');
  return new Function('Platform', 'editorKeyboardDismissMode', `return (${expression});`)({ OS: platform }, editorKeyboardDismissMode);
}

afterEach(() => { TextInputState._currentlyFocusedNode = null; vi.unstubAllGlobals(); });

it.each([0, 18, 136])(
  'keeps the password focused when the generic login Sheet emits scroll offset %i', (y) => {
    const input = { type: 'password', blur: vi.fn() };
    vi.stubGlobal('document', { activeElement: input }); TextInputState._currentlyFocusedNode = input;
    const onScroll = vi.fn();
    const props = { keyboardDismissMode: sheetMode('web'), onScroll, scrollEventThrottle: 16 };
    const element = WebScrollView.render(props, null) as ReactElement;
    const Constructor = element.type as unknown as new (p: typeof props) => { _handleScroll: (event: object) => void };
    new Constructor(props)._handleScroll({ nativeEvent: { contentOffset: { y } } });
    expect(input.blur).not.toHaveBeenCalled();
    expect(onScroll).toHaveBeenCalledOnce();
  },
);

it('keeps native Sheet keyboard dismissal policies', () => {
  expect(sheetMode('ios')).toBe('interactive');
  expect(sheetMode('android')).toBe('on-drag');
});
