import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { parseLocalDateKey } from '../domain/routine';

// Exercise the actual menu JSX/handler without mounting the whole syncing app.
const source = readFileSync('src/app/index.tsx', 'utf8');
const tree = ts.createSourceFile('index.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let expression: ts.Expression | undefined;
function visit(node: ts.Node) {
  if (ts.isJsxSelfClosingElement(node) && node.attributes.properties.some(p => ts.isJsxAttribute(p) &&
      p.name.getText(tree) === 'label' && p.initializer && ts.isStringLiteral(p.initializer) && p.initializer.text === '今回だけ未達')) {
    let parent: ts.Node = node;
    while (!ts.isJsxExpression(parent)) parent = parent.parent;
    expression = parent.expression;
  }
  ts.forEachChild(node, visit);
}
visit(tree);
function menu(date: string | null, type = 'memo', enabled = true) {
  expect(expression, 'occurrence menu action exists').toBeDefined();
  const emitted = ts.transpileModule(`const element = ${expression!.getText(tree)};`, { compilerOptions: { jsx: ts.JsxEmit.React } }).outputText;
  const apply = vi.fn(), result = vi.fn(), close = vi.fn();
  const element = new Function('React', 'Action', 'menuRoutineDate', 'menuNode', 'sync', 'parseLocalDateKey', 'apply', 'setRoutineResult', 'setMenuNode', `${emitted}; return element;`)(
    { createElement: (_type: unknown, props: unknown) => props }, () => null, date, { id: 'selected-routine', type },
    { routineResultsEnabled: enabled }, parseLocalDateKey, apply, result, close);
  return { element, apply, result, close };
}
it('places the action below skip and sends the selected occurrence date through the existing result operation', () => {
  expect(source.indexOf('label="今回だけ未達"')).toBeGreaterThan(source.indexOf('label={menuRoutineDate ? "今回だけスキップ"'));
  const x = menu('2026-11-26');
  x.element.onPress();
  expect(x.apply).toHaveBeenCalledOnce();
  const nodes: unknown[] = [];
  x.apply.mock.calls[0][1](nodes);
  expect(x.result).toHaveBeenCalledWith(nodes, 'selected-routine', new Date(2026, 10, 26), 'missed', expect.any(Date));
  expect(x.close).toHaveBeenCalledWith(null);
});
it('does not expose missed for ordinary tasks, categories or a closed result capability', () => {
  expect(menu(null).element).toBeFalsy();
  expect(menu('2026-11-26', 'category').element).toBeFalsy();
  expect(menu('2026-11-26', 'memo', false).element).toBeFalsy();
});
it('does not replace an invalid occurrence date with today', () => {
  const x = menu('invalid'); x.element.onPress();
  expect(x.apply).not.toHaveBeenCalled();
  expect(x.close).not.toHaveBeenCalled();
});
