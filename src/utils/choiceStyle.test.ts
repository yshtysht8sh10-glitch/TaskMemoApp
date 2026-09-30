import { describe, expect, it } from 'vitest';

import { selectedChoiceStyle } from './choiceStyle';

describe('selected choice style', () => {
  it.each([
    ['light', '#40566c', '#edf4f3'],
    ['dark', '#8fb5d1', '#243b3b'],
  ])('%s theme uses the accent border, distinct fill, and stronger label', (_theme, accent, accentSoft) => {
    const style = selectedChoiceStyle({ accent, accentSoft });
    expect(style.container).toMatchObject({ borderWidth: 1, borderColor: accent, backgroundColor: accentSoft });
    expect(style.label).toMatchObject({ color: accent, fontWeight: '700' });
  });
});
