import { describe, expect, it } from 'vitest';

import { editorDiagnosticsEnabled } from './editorDiagnostics';

describe('editor diagnostics', () => {
  it('only enables logging with an explicit URL flag', () => {
    expect(editorDiagnosticsEnabled('?editorDiagnostics=1')).toBe(true);
    expect(editorDiagnosticsEnabled('?editorDiagnostics=0')).toBe(false);
    expect(editorDiagnosticsEnabled('')).toBe(false);
  });
});
