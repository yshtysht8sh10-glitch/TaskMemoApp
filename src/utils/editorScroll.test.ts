import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// The installed renderer's real scroll handler is the regression target.
// @ts-expect-error react-native-web does not publish types for internal modules.
import WebScrollView from 'react-native-web/dist/exports/ScrollView/index.js';
// @ts-expect-error react-native-web does not publish types for internal modules.
import TextInputState from 'react-native-web/dist/modules/TextInputState/index.js';
import { editorKeyboardDismissMode } from './editorScroll';

type ScrollProps = { keyboardDismissMode: string; onScroll: () => void; scrollEventThrottle: number };
type ScrollInstance = { _handleScroll: (event: object) => void };
function scrollView(mode: string, onScroll: () => void) {
  const props = { keyboardDismissMode: mode, onScroll, scrollEventThrottle: 16 };
  const element = WebScrollView.render(props, null) as ReactElement;
  const Constructor = element.type as unknown as new (props: ScrollProps) => ScrollInstance;
  return new Constructor(props);
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Web editor focus during internal scrolling', () => {
  it('preserves native keyboard dismissal policies', () => {
    expect(editorKeyboardDismissMode('ios')).toBe('interactive');
    expect(editorKeyboardDismissMode('android')).toBe('on-drag');
  });
  it.each([0, 136, 400].flatMap((position) =>
    ['input-reveal', 'selection-start', 'selection-end'].map((operation) => [position, operation] as const),
  ))('keeps input focused at scroll %i during %s', (position) => {
    const input = { blur: vi.fn() };
    vi.stubGlobal('document', { activeElement: input });
    TextInputState._currentlyFocusedNode = input;
    const onScroll = vi.fn();
    const view = scrollView(editorKeyboardDismissMode('web'), onScroll);
    view._handleScroll({ nativeEvent: { contentOffset: { y: position + 18 } } });
    expect(input.blur).not.toHaveBeenCalled();
    expect(onScroll).toHaveBeenCalledOnce();
  });

  it('reproduces the old on-drag blur even for a programmatic scroll', () => {
    const input = { blur: vi.fn() };
    vi.stubGlobal('document', { activeElement: input });
    TextInputState._currentlyFocusedNode = input;
    scrollView('on-drag', vi.fn())._handleScroll({ nativeEvent: { contentOffset: { y: 18 } } });
    expect(input.blur).toHaveBeenCalledOnce();
  });
});
