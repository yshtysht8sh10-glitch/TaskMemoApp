import { describe, expect, it } from 'vitest';
import { dragActivationDelay } from './dragActivation';

describe('dragActivationDelay', () => {
  it('Webだけ開始待ちを短縮し、タッチ端末の誤操作防止値を維持する', () => {
    expect(dragActivationDelay(true)).toBe(120);
    expect(dragActivationDelay(false)).toBe(320);
  });
});
