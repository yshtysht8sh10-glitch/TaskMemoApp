import { afterEach, expect, it, vi } from 'vitest';
import { useWebFocusedInputVisibility } from './useWebKeyboardVisibility';

const effect = vi.hoisted(() => ({ cleanup: undefined as (() => void) | undefined }));
vi.mock('react', () => ({ useEffect: (setup: () => (() => void)) => { effect.cleanup = setup(); } }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('@/utils/focusedInputVisibility', async () => import('../utils/focusedInputVisibility'));
vi.mock('../utils/diagnosticClipboard', () => ({
  keyboardDiagnosticsEnabled: (search: string) => search === '?keyboardDiagnostics=1',
  mountDiagnosticCopyPanel: () => () => {},
}));

// DOM geometry adapter, not an iOS renderer. Values come from log.txt v3,
// sequences 130, 137, 159, 165 (2026-09-17T22:52:57.048Z, iPhone Brave).
// Execute the REAL hook/listeners/timers/scroll writes and remeasure geometry.
// No expected result is calculated using a production scroll-plan function.
function rect(top: number, height: number, width = 402) {
  const value = { top, bottom: top + height, left: 0, right: width, x: 0, y: top, width, height };
  return { ...value, toJSON: () => value };
}
class ElementModel extends EventTarget {
  tagName = 'DIV';
  parentElement: ElementModel | null = null;
  isConnected = true;
  style = { paddingBottom: '' };
  overflowY = 'visible';
  clientHeight = 674;
  clientWidth = 402;
  private position = 0;
  contentHeight = 674;
  writes: number[] = [];
  afterWrite = () => {};
  get scrollHeight() { return this.contentHeight + (parseFloat(this.style.paddingBottom) || 0); }
  get scrollTop() { return this.position; }
  set scrollTop(value: number) {
    this.position = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight));
    this.writes.push(this.position);
    this.afterWrite();
  }
  getBoundingClientRect = vi.fn(() => rect(0, this.clientHeight));
  closest = (_selector: string): ElementModel | null => null;
}
class InputModel extends ElementModel { type = 'text'; tagName = 'INPUT'; }
class TextAreaModel extends ElementModel { tagName = 'TEXTAREA'; }

function browser(diagnostics = false) {
  vi.useFakeTimers();
  const html = new ElementModel();
  const body = new ElementModel();
  body.tagName = 'BODY';
  body.parentElement = html;
  const list = new ElementModel();
  list.parentElement = body;
  list.clientHeight = 530;
  list.contentHeight = 5885;
  list.overflowY = 'auto';
  list.scrollTop = 499;
  list.writes.length = 0;
  const card = new ElementModel();
  card.parentElement = list;
  const input = new InputModel();
  input.parentElement = card;
  input.closest = (selector) => selector.startsWith('[id^=') ? card : null;
  const vv = Object.assign(new EventTarget(), {
    height: 674, width: 402, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1,
  });
  const win = Object.assign(new EventTarget(), {
    innerHeight: 674, innerWidth: 402, scrollY: 0, scrollX: 0,
    visualViewport: vv, location: { search: diagnostics ? '?keyboardDiagnostics=1' : '' },
    scrollTo: vi.fn((_x: number, y: number) => { win.scrollY = y; }),
    getComputedStyle: (element: ElementModel) => ({
      overflowY: element.overflowY, overflowX: 'hidden', paddingBottom: element.style.paddingBottom || '0px',
      getPropertyValue: () => '',
    }),
  });
  const doc = Object.assign(new EventTarget(), {
    documentElement: html, body, activeElement: body, scrollingElement: html,
    getElementById: () => body,
  });
  let contentShift = 0;
  input.getBoundingClientRect = vi.fn(() => rect(1104.328125 + contentShift - list.scrollTop - win.scrollY, 34, 254));
  card.getBoundingClientRect = vi.fn(() => rect(input.getBoundingClientRect().top - 8, 70));
  list.getBoundingClientRect = vi.fn(() => rect(144 - win.scrollY, list.clientHeight));
  vi.stubGlobal('Element', ElementModel);
  vi.stubGlobal('HTMLElement', ElementModel);
  vi.stubGlobal('HTMLInputElement', InputModel);
  vi.stubGlobal('HTMLTextAreaElement', TextAreaModel);
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', { userAgent: 'measured-viewport-fixture' });
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  vi.spyOn(console, 'info').mockImplementation(() => {});
  // useEffect is captured above; exercise its real listener lifecycle without a renderer.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useWebFocusedInputVisibility();
  const focus = (target: ElementModel = input) => {
    doc.dispatchEvent(new Event('pointerdown'));
    doc.activeElement = target;
    doc.dispatchEvent(new Event('focusin'));
  };
  const keyboard = (shrinkLayout = true) => {
    win.innerHeight = shrinkLayout ? 365 : 674;
    html.clientHeight = shrinkLayout ? 390 : 674;
    list.clientHeight = shrinkLayout ? 246 : 530;
    win.scrollY = 25;
    Object.assign(vv, { height: 365, width: 377, offsetTop: 0, pageTop: 25, scale: 1.0671641826629639 });
    win.dispatchEvent(new Event('resize'));
    vv.dispatchEvent(new Event('resize'));
  };
  return { win, doc, vv, html, input, list, card, focus, keyboard,
    shift: (amount: number) => { contentShift += amount; } };
}

afterEach(() => {
  effect.cleanup?.();
  effect.cleanup = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('replays Brave focus → both viewports shrink → page pan → list scroll → measured input visibility', async () => {
  const b = browser();
  b.focus(b.card); // observed card focus before the inline input mounts
  await vi.advanceTimersByTimeAsync(47);
  b.doc.activeElement = b.input;
  b.doc.dispatchEvent(new Event('focusin'));
  expect(b.input.getBoundingClientRect().bottom).toBe(639.328125);
  await vi.advanceTimersByTimeAsync(80);
  expect(b.list.writes).toHaveLength(0); // no keyboard, no correction
  b.keyboard();
  expect(b.input.getBoundingClientRect().bottom).toBe(614.328125);
  expect(b.list.scrollHeight - b.list.clientHeight - b.list.scrollTop).toBe(5140);
  await vi.advanceTimersByTimeAsync(112);
  b.vv.offsetTop = 25;
  b.vv.dispatchEvent(new Event('scroll'));
  await vi.advanceTimersByTimeAsync(2000);
  expect(b.list.scrollTop).toBeGreaterThan(499);
  expect(b.win.scrollY).toBe(0);
  expect(b.win.scrollTo).toHaveBeenCalledExactlyOnceWith(0, 0);
  const bounds = b.input.getBoundingClientRect();
  expect(bounds.bottom).toBeLessThanOrEqual(Math.min(b.vv.offsetTop + b.vv.height, b.list.getBoundingClientRect().bottom) - 16);
  expect(bounds.top).toBeGreaterThanOrEqual(Math.max(b.vv.offsetTop, b.list.getBoundingClientRect().top) + 16);
  expect(bounds.left).toBeGreaterThanOrEqual(Math.max(b.vv.offsetLeft, b.list.getBoundingClientRect().left));
  expect(bounds.right).toBeLessThanOrEqual(Math.min(b.vv.offsetLeft + b.vv.width, b.list.getBoundingClientRect().right));
  expect(b.list.style.paddingBottom).toBe(''); // actual fixture has ample room
  // The first resize has offsetTop=0: 639.328125 - (365 - 16) = 290.328125.
  // The later 25px pan expands visibility, so no further movement is needed.
  expect(b.list.scrollTop).toBeCloseTo(789.328125);
});

it('remeasures after a scroll changes layout and corrects the residual within the list clip', async () => {
  const b = browser();
  b.focus();
  b.keyboard();
  b.vv.offsetTop = 25;
  let shifted = false;
  b.list.afterWrite = () => { if (!shifted) { shifted = true; b.shift(30); } };
  await vi.advanceTimersByTimeAsync(16);
  expect(b.list.writes.length).toBeGreaterThanOrEqual(2);
  expect(b.input.getBoundingClientRect().bottom).toBeLessThanOrEqual(b.list.getBoundingClientRect().bottom - 16);
});

it('does not move a desktop focused input without a viewport contraction', async () => {
  const b = browser();
  b.focus();
  await vi.advanceTimersByTimeAsync(2000);
  expect(b.list.writes).toHaveLength(0);
  expect(b.win.scrollTo).not.toHaveBeenCalled();
});

it('keeps the pre-focus reference through small animation resize steps', async () => {
  const b = browser();
  b.focus();
  for (const height of [644, 614, 584, 554, 524, 494, 464, 434, 404, 390]) {
    b.win.innerHeight = height;
    b.html.clientHeight = height;
    b.vv.height = height;
    b.list.clientHeight = height - 144;
    b.vv.dispatchEvent(new Event('resize'));
    await vi.advanceTimersByTimeAsync(32);
  }
  await vi.advanceTimersByTimeAsync(300);
  expect(b.list.scrollTop).toBeGreaterThan(499);
  expect(b.input.getBoundingClientRect().bottom).toBeLessThanOrEqual(374);
});

it('supports unchanged layout viewport and restores after keyboard dismissal', async () => {
  const b = browser();
  b.focus();
  b.keyboard(false);
  await vi.advanceTimersByTimeAsync(300);
  expect(b.input.getBoundingClientRect().bottom).toBeLessThanOrEqual(349);
  b.win.innerHeight = 674;
  b.html.clientHeight = 674;
  b.list.clientHeight = 530;
  Object.assign(b.vv, { height: 674, width: 402, offsetTop: 0, scale: 1 });
  b.vv.dispatchEvent(new Event('resize'));
  await vi.advanceTimersByTimeAsync(300);
  expect(b.list.scrollTop).toBe(499);
  expect(b.list.style.paddingBottom).toBe('');
});

it('does not mistake zoom alone for keyboard contraction', async () => {
  const b = browser();
  b.focus();
  Object.assign(b.vv, { height: 337, width: 201, scale: 2 });
  b.vv.dispatchEvent(new Event('resize'));
  await vi.advanceTimersByTimeAsync(300);
  expect(b.list.writes).toHaveLength(0);
  expect(b.win.scrollTo).not.toHaveBeenCalled();
});

it('preserves reference across another input focus while keyboard remains open', async () => {
  const b = browser();
  b.focus();
  b.keyboard();
  await vi.advanceTimersByTimeAsync(300);
  b.shift(250);
  b.focus();
  await vi.advanceTimersByTimeAsync(300);
  expect(b.input.getBoundingClientRect().bottom).toBeLessThanOrEqual(b.list.getBoundingClientRect().bottom - 16);
});

it('does not undo correction on an invalid transient viewport sample', async () => {
  const b = browser();
  b.focus();
  b.keyboard();
  await vi.advanceTimersByTimeAsync(300);
  const corrected = b.list.scrollTop;
  b.vv.height = 0;
  b.vv.dispatchEvent(new Event('resize'));
  await vi.advanceTimersByTimeAsync(32);
  expect(b.list.scrollTop).toBe(corrected);
  b.vv.height = 365;
  b.vv.dispatchEvent(new Event('resize'));
  await vi.advanceTimersByTimeAsync(300);
  expect(b.input.getBoundingClientRect().bottom).toBeLessThanOrEqual(374);
});

it('records skip vs zero correction vs applied correction without input contents', async () => {
  const b = browser(true);
  Object.assign(b.input, { value: 'private-memo-title-sentinel' });
  b.focus();
  await vi.advanceTimersByTimeAsync(32);
  b.keyboard();
  await vi.advanceTimersByTimeAsync(300);
  const diagnostics = (b.win as typeof b.win & { taskMemoKeyboardDiagnostics: { export(): string } }).taskMemoKeyboardDiagnostics;
  const json = diagnostics.export();
  expect(json).not.toContain('private-memo-title-sentinel');
  const log = JSON.parse(json) as { entries: { stage: string; reason?: string; actualOffset?: number; inputFullyVisible?: boolean }[] };
  expect(log.entries.some((e) => e.stage === 'correction-skip' && e.reason === 'no-keyboard-contraction')).toBe(true);
  const results = log.entries.filter((e) => e.stage === 'correction-immediate-result');
  expect(results.some((e) => e.actualOffset! > 0 && e.inputFullyVisible)).toBe(true);
  expect(results.some((e) => e.actualOffset === 0 && e.inputFullyVisible)).toBe(true);
});

it('retains end-of-list padding only when necessary and removes it on dismissal', async () => {
  const b = browser();
  b.list.contentHeight = 1029; // initially at the real end: 499 + 530
  b.shift(500); // separate synthetic boundary case, not the Brave log fixture
  b.focus();
  b.keyboard();
  await vi.advanceTimersByTimeAsync(300);
  expect(parseFloat(b.list.style.paddingBottom)).toBeGreaterThan(0);
  expect(b.input.getBoundingClientRect().bottom).toBeLessThanOrEqual(b.list.getBoundingClientRect().bottom - 16);
  b.win.innerHeight = 674;
  b.html.clientHeight = 674;
  b.list.clientHeight = 530;
  Object.assign(b.vv, { height: 674, width: 402, scale: 1, offsetTop: 0 });
  b.vv.dispatchEvent(new Event('resize'));
  await vi.advanceTimersByTimeAsync(300);
  expect(b.list.style.paddingBottom).toBe('');
  expect(b.list.scrollTop).toBe(499);
});

it('remeasures again on the existing settle timer after a delayed layout change', async () => {
  const b = browser();
  b.focus();
  b.keyboard();
  await vi.advanceTimersByTimeAsync(180);
  b.shift(40);
  expect(b.input.getBoundingClientRect().bottom).toBeGreaterThan(Math.min(b.vv.offsetTop + b.vv.height, b.list.getBoundingClientRect().bottom));
  await vi.advanceTimersByTimeAsync(120);
  expect(b.input.getBoundingClientRect().bottom).toBeLessThanOrEqual(b.list.getBoundingClientRect().bottom - 16);
});

it('does not scroll an already visible input or restore the page unnecessarily', async () => {
  const b = browser();
  b.shift(-350);
  b.focus();
  b.keyboard();
  b.win.scrollY = 0;
  await vi.advanceTimersByTimeAsync(300);
  expect(b.list.writes).toHaveLength(0);
  expect(b.win.scrollTo).not.toHaveBeenCalled();
});

it('does not restore the page or scroll the body when no internal scroll target exists', async () => {
  const b = browser();
  b.list.overflowY = 'visible';
  b.focus();
  b.keyboard();
  await vi.advanceTimersByTimeAsync(300);
  expect(b.list.writes).toHaveLength(0);
  expect(b.win.scrollTo).not.toHaveBeenCalled();
});

it('cleans up pending corrections and event listeners', async () => {
  const b = browser();
  b.focus();
  b.keyboard();
  effect.cleanup?.();
  effect.cleanup = undefined;
  await vi.advanceTimersByTimeAsync(300);
  b.vv.dispatchEvent(new Event('resize'));
  await vi.advanceTimersByTimeAsync(300);
  expect(b.list.writes).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
});
