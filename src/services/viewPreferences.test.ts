import { describe, expect, it } from 'vitest';

import { DEFAULT_TREE_DISPLAY_PREFERENCES, parseTreeDisplayPreferences, clampPinnedNoteHeight, PINNED_NOTE_HEIGHT_MAX, PINNED_NOTE_HEIGHT_MIN } from './viewPreferences';

describe('clampPinnedNoteHeight', () => {
  it('保存可能な範囲に高さを収める', () => {
    expect(clampPinnedNoteHeight(20)).toBe(PINNED_NOTE_HEIGHT_MIN);
    expect(clampPinnedNoteHeight(160)).toBe(160);
    expect(clampPinnedNoteHeight(999)).toBe(PINNED_NOTE_HEIGHT_MAX);
  });
});

describe('tree display preferences', () => {
  it('初期値は完了Memo非表示で、保存値を復元する', () => {
    expect(DEFAULT_TREE_DISPLAY_PREFERENCES.showCompletedMemos).toBe(false);
    expect(parseTreeDisplayPreferences('{"showCompletedMemos":true}')).toEqual({ showCompletedMemos: true });
    expect(parseTreeDisplayPreferences('{"showCompletedMemos":false}')).toEqual({ showCompletedMemos: false });
    expect(parseTreeDisplayPreferences('invalid')).toEqual(DEFAULT_TREE_DISPLAY_PREFERENCES);
  });
});
