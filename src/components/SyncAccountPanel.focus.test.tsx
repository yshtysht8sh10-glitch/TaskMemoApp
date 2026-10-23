// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SyncAccountPanel } from './SyncAccountPanel';

vi.mock('../theme/theme', () => ({ useAppTheme: () => ({ colors: { text: '#111', border: '#aaa', surface: '#fff' } }) }));
vi.mock('react-native', async () => {
  const React = await import('react');
  const flatten = (s: unknown): Record<string, unknown> => Array.isArray(s) ? Object.assign({}, ...s.map(flatten)) : (s ?? {}) as Record<string, unknown>;
  const Box = (p: Record<string, unknown>) => React.createElement('div', { style: flatten(p.style) }, p.children as React.ReactNode);
  return { Platform: { OS: 'web' }, StyleSheet: { create: (s: unknown) => s, flatten }, View: Box, Text: Box,
    Pressable: (p: Record<string, unknown>) => React.createElement('button', { disabled: p.disabled, onClick: p.onPress }, p.children as React.ReactNode),
    TextInput: React.forwardRef(function Input(p: Record<string, unknown>, ref) {
      return React.createElement('input', { ref, type: p.secureTextEntry ? 'password' : 'text', placeholder: p.placeholder,
        value: p.value, style: flatten(p.style), onFocus: p.onFocus, onBlur: p.onBlur,
        onChange: () => {}, onInput: (e: React.FormEvent<HTMLInputElement>) => (p.onChangeText as (value: string) => void)(e.currentTarget.value) });
    }),
  };
});

it('keeps the same focused password input and draft through typing and startup/status rerenders without calling Auth', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const props = { protocol: 2 as const, configured: true, environment: 'development' as const, configurationError: null,
    user: null, status: 'signed-out' as const, error: null, applicationState: 'ready', localActive: true,
    onSignIn: vi.fn(), onSignUp: vi.fn(), onSignOut: vi.fn() };
  try {
    await act(async () => { root.render(<SyncAccountPanel {...props} />); });
    const password = host.querySelector('input[type="password"]') as HTMLInputElement;
    const lostFocus = vi.fn(); password.addEventListener('blur', lostFocus);
    await act(async () => {
      password.focus(); password.value = 'synthetic-password'; password.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(document.activeElement).toBe(password);
    expect(password.style.fontSize).toBe('16px');
    await act(async () => { root.render(<SyncAccountPanel {...props} status="connecting" applicationState="opening" />); });
    expect(host.querySelector('input[type="password"]')).toBe(password);
    expect(document.activeElement).toBe(password);
    expect(password.value).toBe('synthetic-password');
    expect(lostFocus).not.toHaveBeenCalled();
    expect(props.onSignIn).not.toHaveBeenCalled(); expect(props.onSignUp).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
