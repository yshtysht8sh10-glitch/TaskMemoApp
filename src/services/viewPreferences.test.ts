import { describe, expect, it } from 'vitest';

import { clampPinnedNoteHeight, PINNED_NOTE_HEIGHT_MAX, PINNED_NOTE_HEIGHT_MIN } from './viewPreferences';

describe('clampPinnedNoteHeight', () => {
  it('保存可能な範囲に高さを収める', () => {
    expect(clampPinnedNoteHeight(20)).toBe(PINNED_NOTE_HEIGHT_MIN);
    expect(clampPinnedNoteHeight(160)).toBe(160);
    expect(clampPinnedNoteHeight(999)).toBe(PINNED_NOTE_HEIGHT_MAX);
  });
});
