import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { FormTextInput } from './FormTextInput';
const state = vi.hoisted(() => ({ platform: 'web', props: {} as Record<string, unknown> }));
vi.mock('react-native', async () => {
  const React = await import('react');
  const flatten = (style: unknown): Record<string, unknown> => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : (style || {}) as Record<string, unknown>;
  return {
    Platform: { get OS() { return state.platform; } }, StyleSheet: { flatten },
    TextInput: React.forwardRef(function Input(props: Record<string, unknown>, ref) {
      state.props = { ...props, ref };
      return React.createElement('textarea', { style: flatten(props.style), readOnly: props.editable === false, defaultValue: props.value });
    }),
  };
});
it('renders final Web size after conflicting styles and retains input contract', () => {
  const ref = React.createRef<import('react-native').TextInput>();
  const onChangeText = vi.fn(), onSelectionChange = vi.fn();
  const html = renderToStaticMarkup(<FormTextInput ref={ref} style={[{ fontSize: 24 }, { fontSize: 14, lineHeight: 22 }]} value="日本語" multiline onChangeText={onChangeText} onSelectionChange={onSelectionChange} autoFocus />);
  expect(html).toContain('font-size:16px');
  expect(html).toContain('line-height:22');
  expect(state.props).toMatchObject({ ref, onChangeText, onSelectionChange, autoFocus: true, multiline: true, value: '日本語' });
});
it('retains larger Web text and read-only selection controls', () => {
  expect(renderToStaticMarkup(<FormTextInput style={{ fontSize: 24 }} editable={false} />)).toContain('font-size:24px');
  expect(state.props.editable).toBe(false);
});
it('leaves native style identity unchanged', () => {
  state.platform = 'android';
  const style = [{ fontSize: 14 }];
  renderToStaticMarkup(<FormTextInput style={style} />);
  expect(state.props.style).toBe(style);
  state.platform = 'web';
});
