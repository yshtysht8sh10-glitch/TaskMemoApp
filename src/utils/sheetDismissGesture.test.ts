import { describe, expect, it } from 'vitest';

import { canStartSheetDismiss, sheetDismissRelease } from './sheetDismissGesture';

describe('sheet dismiss gesture', () => {
  it('内部scroll途中ではdismissを開始しない', () => {
    expect(canStartSheetDismiss({ scrollOffset: 20, dx: 0, dy: 30 })).toBe(false);
  });

  it('最上部からの下方向dragだけdismissを開始する', () => {
    expect(canStartSheetDismiss({ scrollOffset: 0, dx: 1, dy: 12 })).toBe(true);
    expect(canStartSheetDismiss({ scrollOffset: 0, dx: 1, dy: -12 })).toBe(false);
  });

  it('閾値未満なら元位置へ戻り、閾値以上ならcommitしてcloseする', () => {
    expect(sheetDismissRelease({ distance: 79, velocity: 0.2, viewportHeight: 400 })).toBe('restore');
    expect(sheetDismissRelease({ distance: 80, velocity: 0.2, viewportHeight: 400 })).toBe('commit-close');
  });

  it('十分な下方向速度でもcommitしてcloseし、cancelにはしない', () => {
    expect(sheetDismissRelease({ distance: 30, velocity: 1.1, viewportHeight: 800 })).toBe('commit-close');
  });
});
