import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';

// Check the actual JSX contract, including every conditional editor input.
// Mobile keyboard display itself remains a real-device acceptance check.
const file = ts.createSourceFile('index.tsx', readFileSync(new URL('../app/index.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const editor = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'EditorModal')!;
function elements(name: string) {
  const result: (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] = [];
  function visit(node: ts.Node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(file) === name) result.push(node);
    ts.forEachChild(node, visit);
  }
  visit(editor);
  return result;
}
it('opens every editor input without requesting focus', () => {
  const inputs = elements('TextInput');
  expect(inputs.length).toBeGreaterThan(1);
  for (const input of inputs) {
    expect(input.attributes.properties.some((prop) => ts.isJsxAttribute(prop) && prop.name.getText(file) === 'autoFocus')).toBe(false);
  }
});
it('gives the Web modal focus trap a non-input sheet target', () => {
  const sheet = elements('Animated.View').find((node) => node.getText(file).includes('editor-sheet'))!;
  expect(sheet.getText(file)).toContain('tabIndex={Platform.OS === "web" ? -1 : undefined}');
});
