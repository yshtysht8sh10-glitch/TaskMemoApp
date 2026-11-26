// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { RoutineResultIcon } from './RoutineResultMark';
// Exercise the installed renderer, rather than translating Native props in a mock.
vi.mock('react-native', () => vi.importActual('react-native-web'));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it.each(['completed', 'skipped', 'pending'] as const)('web %s icon is decorative in the real RNW DOM', async state => {
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<RoutineResultIcon state={state} color="#18723c" />));
    expect(host.querySelector(`[data-testid="routine-result-icon-${state}"]`)?.getAttribute('aria-hidden')).toBe('true');
  } finally { await act(async () => root.unmount()); }
});
