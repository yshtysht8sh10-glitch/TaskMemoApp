import { mountDiagnosticCopyPanel } from './diagnosticClipboard';

export function editorDiagnosticsEnabled(search: string) {
  return new URLSearchParams(search).get('editorDiagnostics') === '1';
}

type DiagnosticEntry = Record<string, unknown>;
const entries: DiagnosticEntry[] = [];
let enabled = false;
let active = false;

function geometry() {
  const scroll = document.getElementById('editor-keyboard-scroll');
  const input = document.getElementById('editor-body-input');
  const sheet = document.getElementById('editor-sheet');
  const rect = (element: Element | null) => {
    if (!element) return null;
    const { top, bottom, left, right } = element.getBoundingClientRect();
    return { top, bottom, left, right };
  };
  const viewport = window.visualViewport;
  return {
    scrollTop: scroll?.scrollTop ?? null,
    windowScrollY: window.scrollY,
    viewportHeight: viewport?.height ?? window.innerHeight,
    viewportOffsetTop: viewport?.offsetTop ?? 0,
    inputRect: rect(input),
    sheetRect: rect(sheet),
    active: document.activeElement === input ? 'body-input' : document.activeElement?.tagName ?? null,
  };
}

export function recordEditorDiagnostic(stage: string, details: DiagnosticEntry = {}) {
  if (!enabled || typeof document === 'undefined') return;
  entries.push({ sequence: entries.length, timeMs: performance.now(), stage, ...geometry(), ...details });
  if (entries.length > 600) entries.shift();
}

export function installEditorDiagnostics(force = false) {
  if (typeof window === 'undefined' || (!force && !editorDiagnosticsEnabled(window.location.search)) || active) return () => {};
  active = true;
  enabled = true;
  entries.length = 0;
  const classify = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return 'other';
    if (target.closest('#editor-body-input')) return 'body-input';
    if (target.closest('#editor-grabber')) return 'grabber';
    if (target.closest('#editor-sheet')) return 'sheet';
    if (target.closest('#editor-backdrop')) return 'backdrop';
    return 'outside';
  };
  const names = ['focusin', 'focusout', 'pointerdown', 'pointerup', 'pointercancel',
    'touchstart', 'touchend', 'touchcancel', 'click', 'selectionchange', 'scroll'];
  const listeners = names.map((name) => {
    const listener = (event: Event) => {
      const target = classify(event.target);
      if (target === 'outside' && name !== 'selectionchange' && name !== 'scroll') return;
      const pointer = event as PointerEvent;
      const touch = (event as TouchEvent).changedTouches?.[0];
      recordEditorDiagnostic(name, {
        target,
        x: touch?.clientX ?? (Number.isFinite(pointer.clientX) ? pointer.clientX : null),
        y: touch?.clientY ?? (Number.isFinite(pointer.clientY) ? pointer.clientY : null),
        cancelable: event.cancelable,
      });
    };
    document.addEventListener(name, listener, true);
    return () => document.removeEventListener(name, listener, true);
  });
  const viewportListener = () => recordEditorDiagnostic('visualViewport-change');
  window.visualViewport?.addEventListener('resize', viewportListener);
  window.visualViewport?.addEventListener('scroll', viewportListener);
  const copyPanel = mountDiagnosticCopyPanel(
    '?keyboardDiagnostics=1',
    () => JSON.stringify({ version: 1, build: 'editor-diagnostics', entries }, null, 2),
    navigator.clipboard,
    document,
  );
  recordEditorDiagnostic('diagnostics-installed');
  return () => {
    listeners.forEach((remove) => remove());
    window.visualViewport?.removeEventListener('resize', viewportListener);
    window.visualViewport?.removeEventListener('scroll', viewportListener);
    copyPanel();
    enabled = false;
    active = false;
  };
}
