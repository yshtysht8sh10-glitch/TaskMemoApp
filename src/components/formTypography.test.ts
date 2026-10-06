import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { formFontSize, WEB_FORM_MIN_FONT_SIZE } from '../theme/formTypography';
it('routes text workspace and account fields through the shared form control', () => {
  for (const file of ['TextWorkspace', 'SyncAccountPanel']) {
    const source = readFileSync(`src/components/${file}.tsx`, 'utf8');
    expect(source).not.toMatch(/<TextInput\s/);
    expect(source.match(/<FormTextInput\s/g)).toHaveLength(2);
  }
});

it('clamps Web sizes while preserving larger sizes and native styles', () => {
  expect(formFontSize('web', 14)).toBe(16);
  expect(formFontSize('web')).toBe(16);
  expect(formFontSize('web', 24)).toBe(24);
  expect(formFontSize('ios', 14)).toBe(14);
  expect(formFontSize('android', 14)).toBe(14);
  expect(formFontSize('android')).toBeUndefined();
});
it('applies the minimum after caller overrides and preserves refs/events', () => {
  const source = readFileSync('src/components/FormTextInput.tsx', 'utf8');
  expect(source).toContain('StyleSheet.flatten(style)?.fontSize');
  expect(source).toContain('[style, { fontSize }] : style');
  expect(source).toContain('{...props} ref={ref}');
});
it('shares DOM typography with diagnostics and contenteditable without disabling zoom', () => {
  const css = readFileSync('public/form-typography.css', 'utf8');
  expect(css).toContain(`max(${WEB_FORM_MIN_FONT_SIZE}px,`);
  expect(css).toContain('[contenteditable="plaintext-only"]');
  const html = readFileSync('public/storage-diagnostics.html', 'utf8');
  expect(html).toContain('/form-typography.css');
  expect(html.match(/#result\s*\{([^}]+)\}/)?.[1]).not.toContain('font-size');
  expect(readFileSync('src/app/+html.tsx', 'utf8')).not.toMatch(/user-scalable|maximum-scale/);
});

it('covers every current native text input entry point', () => {
  for (const [file, count] of [['src/app/index.tsx', 3], ['src/components/DeadlineView.tsx', 5], ['src/components/MemoRow.tsx', 1], ['src/components/QuickTitleEditor.tsx', 1]] as const) {
    const source = readFileSync(file, 'utf8');
    expect(source).not.toMatch(/<TextInput\s/);
    expect(source.match(/<FormTextInput\s/g)).toHaveLength(count);
  }
  for (const file of ['DateField', 'DateTimeField', 'TimeField']) {
    expect(readFileSync(`src/components/${file}.tsx`, 'utf8')).toContain('...webFormTypography');
  }
});
