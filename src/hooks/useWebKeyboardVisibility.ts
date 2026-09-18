import { useEffect } from "react";
import { Platform } from "react-native";
import { keyboardDiagnosticsEnabled as diagnosticsEnabled, mountDiagnosticCopyPanel } from '../utils/diagnosticClipboard';

import {
  focusedInputScrollOffset,
  focusedInputScrollPlan,
  normalizeVisibleViewport,
  type VisibleViewport,
} from "@/utils/focusedInputVisibility";

const KEYBOARD_SETTLE_DELAYS = [80, 280];

// Keep the pre-keyboard reference even when the layout viewport also resizes.
// Scale compensation avoids treating focus/pinch zoom alone as a keyboard.
function viewportSample() {
  const vv = window.visualViewport;
  const height = vv?.height ?? window.innerHeight;
  const scale = vv?.scale ?? 1;
  return {
    height: Math.max(layoutViewport().height, height * scale),
    visibleHeight: height * scale,
    width: document.documentElement.clientWidth,
    valid: Number.isFinite(height) && height >= 160 && Number.isFinite(scale) && scale > 0,
  };
}
type KeyboardState = {
  keyboardVisible: boolean;
  reason: string;
  referenceHeight: number;
  currentHeight: number;
  contraction: number;
};
let diagnosticKeyboardState: (() => KeyboardState) | undefined;

function layoutViewport(): VisibleViewport {
  return {
    height: Math.max(
      window.innerHeight,
      document.documentElement.clientHeight,
    ),
    offsetTop: 0,
  };
}

function currentViewport(layout: VisibleViewport): VisibleViewport {
  const viewport = window.visualViewport;
  return normalizeVisibleViewport(
    {
      height: viewport?.height ?? layout.height,
      offsetTop: viewport?.offsetTop ?? 0,
    },
    layout,
  );
}

function isTextEntry(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element instanceof HTMLTextAreaElement) return true;
  if (!(element instanceof HTMLInputElement)) return false;
  return !["button", "checkbox", "file", "hidden", "radio", "range"].includes(
    element.type,
  );
}

function scrollableAncestor(element: HTMLElement) {
  const keyboardContainer = element.closest("#editor-keyboard-scroll");
  if (keyboardContainer instanceof HTMLElement) return keyboardContainer;
  let ancestor = element.parentElement;
  while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
    const overflowY = window.getComputedStyle(ancestor).overflowY;
    if (/auto|scroll/.test(overflowY)) return ancestor;
    ancestor = ancestor.parentElement;
  }
  return null;
}

function keyboardDiagnosticsEnabled() {
  return diagnosticsEnabled(window.location.search);
}

// Opt-in, memory-only evidence. Never record titles, values or account data.
const diagnosticEntries: Record<string, unknown>[] = [];
const diagnosticIds = new WeakMap<Element, number>();
let nextDiagnosticId = 1;
function diagnosticElement(element: Element | null) {
  if (!element) return null;
  if (!diagnosticIds.has(element)) diagnosticIds.set(element, nextDiagnosticId++);
  const css = window.getComputedStyle(element);
  return {
    token: diagnosticIds.get(element), tag: element.tagName,
    bounds: element.getBoundingClientRect().toJSON(),
    scrollTop: element.scrollTop, scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight, clientWidth: element.clientWidth,
    connected: element.isConnected,
    css: { overflowX: css.overflowX, overflowY: css.overflowY,
      position: css.position, transform: css.transform, fontSize: css.fontSize,
      paddingBottom: css.paddingBottom, paddingTop: css.paddingTop,
      boxSizing: css.boxSizing, height: css.height, flexShrink: css.flexShrink,
      scrollBehavior: css.scrollBehavior, overflowAnchor: css.getPropertyValue('overflow-anchor') },
  };
}

function recordKeyboardDiagnostic(stage: string, details: Record<string, unknown> = {}) {
  if (!keyboardDiagnosticsEnabled()) return;
  const active = document.activeElement;
  const input = isTextEntry(active) ? active : null;
  const ancestors = [];
  for (let parent = input?.parentElement; parent; parent = parent.parentElement)
    ancestors.push(diagnosticElement(parent));
  const layout = layoutViewport();
  const normalized = currentViewport(layout);
  const vv = window.visualViewport;
  const entry = {
    stage, timeMs: performance.now(), sequence: diagnosticEntries.length,
    active: diagnosticElement(active), ancestors,
    selectedContainer: input ? diagnosticElement(scrollableAncestor(input)) : null,
    card: diagnosticElement(input?.closest('[id^="deadline-memo-"]') ?? null),
    root: diagnosticElement(document.getElementById('root')),
    body: diagnosticElement(document.body), document: diagnosticElement(document.documentElement),
    scrollingElement: diagnosticElement(document.scrollingElement),
    window: { scrollX: window.scrollX, scrollY: window.scrollY,
      innerHeight: window.innerHeight, innerWidth: window.innerWidth },
    rawViewport: vv ? { height: vv.height, width: vv.width, offsetTop: vv.offsetTop,
      offsetLeft: vv.offsetLeft, pageTop: vv.pageTop, pageLeft: vv.pageLeft, scale: vv.scale } : null,
    layout, normalized, keyboard: diagnosticKeyboardState?.(),
    correctionAllowed: diagnosticKeyboardState?.().keyboardVisible ?? false,
    keyboardTop: normalized.offsetTop + normalized.height,
    // This is a viewport boundary, not a measurement of the OS keyboard.
    rawVisibleBottom: vv ? vv.offsetTop + vv.height : null,
    ...details,
  };
  diagnosticEntries.push(entry);
  if (diagnosticEntries.length > 1200) diagnosticEntries.shift();
}

function logKeyboardGeometry(
  stage: "focus" | "before-correction" | "after-correction",
  element: HTMLElement,
  scrollContainer: HTMLElement | null,
  viewport: VisibleViewport,
  details: Record<string, unknown> = {},
) {
  if (!keyboardDiagnosticsEnabled()) return;
  const card = element.closest('[id^="deadline-memo-"]');
  console.info("[TaskMemo keyboard]", {
    stage,
    activeElement: element.id || element.tagName,
    inputBounds: element.getBoundingClientRect().toJSON(),
    cardBounds: card?.getBoundingClientRect().toJSON() ?? null,
    containerBounds: scrollContainer?.getBoundingClientRect().toJSON() ?? null,
    scrollTop: scrollContainer?.scrollTop ?? null,
    scrollHeight: scrollContainer?.scrollHeight ?? null,
    clientHeight: scrollContainer?.clientHeight ?? null,
    windowScrollY: window.scrollY,
    windowInnerHeight: window.innerHeight,
    visualViewportHeight: window.visualViewport?.height ?? null,
    visualViewportOffsetTop: window.visualViewport?.offsetTop ?? null,
    keyboardTop: viewport.offsetTop + viewport.height,
    ...details,
  });
}

function revealFocusedInput(
  adjustedContainers: Map<HTMLElement, { paddingBottom: string; scrollTop: number }>,
  baselineWindowScrollY: number,
) {
  const element = document.activeElement;
  recordKeyboardDiagnostic('correction-attempt', { baselineWindowScrollY });
  if (!isTextEntry(element)) {
    recordKeyboardDiagnostic('correction-skip', { reason: 'no-text-input' });
    return;
  }
  const scrollContainer = scrollableAncestor(element);
  if (!scrollContainer) {
    recordKeyboardDiagnostic('correction-skip', { reason: 'no-internal-scroll-container' });
    return;
  }
  // Never use a predicted input position from before restoring the page.
  if (window.scrollY !== baselineWindowScrollY) {
    recordKeyboardDiagnostic('page-scroll-detected', { baselineWindowScrollY });
    window.scrollTo(window.scrollX, baselineWindowScrollY);
    recordKeyboardDiagnostic('page-scroll-restored', { baselineWindowScrollY });
  }
  const availableViewport = (): VisibleViewport => {
    const visible = currentViewport(layoutViewport());
    const bounds = scrollContainer.getBoundingClientRect();
    const top = Math.max(visible.offsetTop, bounds.top);
    const bottom = Math.min(visible.offsetTop + visible.height, bounds.bottom);
    return { offsetTop: top, height: Math.max(0, bottom - top) };
  };
  const viewport = availableViewport();
  if (viewport.height <= 32) {
    recordKeyboardDiagnostic('correction-skip', { reason: 'no-visible-scroll-region', viewport });
    return;
  }
  const requestedOffset = focusedInputScrollOffset(element.getBoundingClientRect(), viewport);
  const scrollTopBefore = scrollContainer.scrollTop;
  logKeyboardGeometry("before-correction", element, scrollContainer, viewport, {
    baselineWindowScrollY,
    calculatedScrollOffset: requestedOffset,
  });
  recordKeyboardDiagnostic('before-correction', { requestedOffset, availableViewport: viewport });
  const applyOffset = (offset: number) => {
    if (!offset) return;
    if (!adjustedContainers.has(scrollContainer))
      adjustedContainers.set(scrollContainer, {
        paddingBottom: scrollContainer.style.paddingBottom,
        scrollTop: scrollContainer.scrollTop,
      });
    const plan = focusedInputScrollPlan(scrollContainer, offset);
    if (plan.extraBottomSpace > 0) {
      const currentPadding = Number.parseFloat(
        window.getComputedStyle(scrollContainer).paddingBottom,
      ) || 0;
      scrollContainer.style.paddingBottom = `${currentPadding + plan.extraBottomSpace}px`;
    }
    scrollContainer.scrollTop = plan.targetScrollTop;
  };
  applyOffset(requestedOffset);
  const residualOffset = focusedInputScrollOffset(element.getBoundingClientRect(), availableViewport());
  recordKeyboardDiagnostic('before-residual-correction', { residualOffset });
  applyOffset(residualOffset);
  const finalViewport = availableViewport();
  const finalBounds = element.getBoundingClientRect();
  const containerBounds = scrollContainer.getBoundingClientRect();
  const visualLeft = window.visualViewport?.offsetLeft ?? 0;
  const visualRight = visualLeft + (window.visualViewport?.width ?? window.innerWidth);
  recordKeyboardDiagnostic('correction-immediate-result', {
    requestedOffset, residualOffset,
    actualOffset: scrollContainer.scrollTop - scrollTopBefore,
    remainingOffset: focusedInputScrollOffset(finalBounds, finalViewport),
    availableViewport: finalViewport,
    inputFullyVisible: finalBounds.top >= finalViewport.offsetTop + 16 &&
      finalBounds.bottom <= finalViewport.offsetTop + finalViewport.height - 16 &&
      finalBounds.left >= Math.max(visualLeft, containerBounds.left) &&
      finalBounds.right <= Math.min(visualRight, containerBounds.right),
  });
  logKeyboardGeometry("after-correction", element, scrollContainer, finalViewport, {
    appliedScrollOffset: scrollContainer.scrollTop - scrollTopBefore,
    inputVisibleAboveKeyboard:
      finalBounds.bottom < finalViewport.offsetTop + finalViewport.height,
  });
}

export function useWebFocusedInputVisibility() {
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const viewport = window.visualViewport;
    let reference = viewportSample();
    const keyboardState = (): KeyboardState => {
      const current = viewportSample();
      const contraction = Math.max(reference.height, layoutViewport().height) - current.visibleHeight;
      const reason = !current.valid ? 'invalid-viewport'
        : current.width !== reference.width ? 'layout-width-changed'
        : contraction >= 80 ? 'viewport-contracted' : 'no-keyboard-contraction';
      return { keyboardVisible: reason === 'viewport-contracted', reason,
        referenceHeight: reference.height, currentHeight: current.visibleHeight, contraction };
    };
    diagnosticKeyboardState = keyboardState;
    const diagnosticTimers = new Set<ReturnType<typeof setTimeout>>();
    const diagnosticFrames = new Set<number>();
    const diagnosticListeners: (() => void)[] = [];
    if (keyboardDiagnosticsEnabled()) {
      diagnosticEntries.length = 0;
      const diagnosticWindow = window as typeof window & { taskMemoKeyboardDiagnostics?: { export: () => string } };
      diagnosticWindow.taskMemoKeyboardDiagnostics = {
        export: () => {
          recordKeyboardDiagnostic('export');
          return JSON.stringify({ version: 4, timestamp: new Date().toISOString(), userAgent: navigator.userAgent, entries: diagnosticEntries }, null, 2);
        },
      };
      diagnosticListeners.push(mountDiagnosticCopyPanel(
        window.location.search,
        () => diagnosticWindow.taskMemoKeyboardDiagnostics!.export(),
        navigator.clipboard,
        document,
      ));
      const observe = (target: EventTarget, name: string, label: string) => {
        const listener = (event: Event) => {
          recordKeyboardDiagnostic(label, { eventTarget: event.target instanceof Element ? diagnosticElement(event.target) : null });
          if (name !== 'focusin') return;
          // Observe the same input after the app's 80/280ms correction window;
          // these probes never request focus, scrolling or style changes.
          const focused = document.activeElement;
          const sample = (stage: string) => recordKeyboardDiagnostic(stage, {
            originalInput: diagnosticElement(focused), sameActive: focused === document.activeElement,
          });
          const frameId = requestAnimationFrame(() => {
            diagnosticFrames.delete(frameId); sample('focus-next-frame');
          });
          diagnosticFrames.add(frameId);
          [80, 280, 600, 1200, 2000].forEach((delay) => {
            const timer = setTimeout(() => { diagnosticTimers.delete(timer); sample(`focus+${delay}ms`); }, delay);
            diagnosticTimers.add(timer);
          });
        };
        target.addEventListener(name, listener, { capture: true, passive: true });
        diagnosticListeners.push(() => target.removeEventListener(name, listener, true));
      };
      ['pointerdown', 'focusin', 'focusout', 'scroll'].forEach((name) => observe(document, name, `document:${name}`));
      ['resize', 'scroll'].forEach((name) => {
        observe(window, name, `window:${name}`);
        if (viewport) observe(viewport, name, `visualViewport:${name}`);
      });
      recordKeyboardDiagnostic('installed');
      diagnosticListeners.push(() => { delete diagnosticWindow.taskMemoKeyboardDiagnostics; });
    }
    const adjustedContainers = new Map<HTMLElement, { paddingBottom: string; scrollTop: number }>();
    let baselineWindowScrollY = window.scrollY;
    let pendingFocus: { scrollY: number; reference: ReturnType<typeof viewportSample> } | null = null;
    let frame: number | null = null;
    let hadKeyboard = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const runCorrection = () => {
      const state = keyboardState();
      if (state.keyboardVisible) {
        hadKeyboard = true;
        revealFocusedInput(adjustedContainers, baselineWindowScrollY);
        return;
      }
      recordKeyboardDiagnostic('correction-skip', { reason: state.reason });
      // Invalid samples during animation must not undo a successful correction.
      if (state.reason === 'invalid-viewport') return;
      if (adjustedContainers.size) {
        recordKeyboardDiagnostic('restore-containers', { count: adjustedContainers.size });
        adjustedContainers.forEach((original, container) => {
          if (container.isConnected) {
            container.style.paddingBottom = original.paddingBottom;
            container.scrollTop = original.scrollTop;
          }
        });
        adjustedContainers.clear();
      }
      // Do not chase small resize steps during keyboard opening animation.
      // Rebase only outside editing, after dismissal, or on a width change.
      if (!isTextEntry(document.activeElement) || hadKeyboard || state.reason === 'layout-width-changed')
        reference = viewportSample();
      hadKeyboard = false;
    };
    const scheduleReveal = () => {
      recordKeyboardDiagnostic('schedule', { cancelFrame: frame !== null, cancelTimerCount: timers.size });
      if (frame !== null) cancelAnimationFrame(frame);
      timers.forEach(clearTimeout);
      timers.clear();
      frame = requestAnimationFrame(() => {
        recordKeyboardDiagnostic('correction-rAF');
        runCorrection();
        frame = null;
      });
      KEYBOARD_SETTLE_DELAYS.forEach((delay) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          recordKeyboardDiagnostic('correction-timer', { delay });
          runCorrection();
        }, delay);
        timers.add(timer);
      });
    };

    const capturePreFocusScroll = () => {
      if (!keyboardState().keyboardVisible) {
        pendingFocus = { scrollY: window.scrollY, reference: viewportSample() };
        recordKeyboardDiagnostic('before-focus');
      }
    };
    const handleFocusIn = () => {
      const element = document.activeElement;
      if (isTextEntry(element)) {
        if (pendingFocus) {
          reference = pendingFocus.reference;
          baselineWindowScrollY = pendingFocus.scrollY;
          pendingFocus = null;
        } else if (!keyboardState().keyboardVisible) {
          reference = viewportSample();
          baselineWindowScrollY = window.scrollY;
        }
        const layout = layoutViewport();
        logKeyboardGeometry(
          "focus",
          element,
          scrollableAncestor(element),
          currentViewport(layout),
          { baselineWindowScrollY },
        );
      }
      scheduleReveal();
    };
    document.addEventListener("pointerdown", capturePreFocusScroll, true);
    document.addEventListener("focusin", handleFocusIn);
    viewport?.addEventListener("resize", scheduleReveal);
    viewport?.addEventListener("scroll", scheduleReveal);
    window.addEventListener("resize", scheduleReveal);
    return () => {
      diagnosticListeners.forEach((remove) => remove());
      diagnosticTimers.forEach(clearTimeout);
      diagnosticFrames.forEach(cancelAnimationFrame);
      document.removeEventListener("pointerdown", capturePreFocusScroll, true);
      document.removeEventListener("focusin", handleFocusIn);
      viewport?.removeEventListener("resize", scheduleReveal);
      viewport?.removeEventListener("scroll", scheduleReveal);
      window.removeEventListener("resize", scheduleReveal);
      if (frame !== null) cancelAnimationFrame(frame);
      timers.forEach(clearTimeout);
      adjustedContainers.clear();
      if (diagnosticKeyboardState === keyboardState) diagnosticKeyboardState = undefined;
    };
  }, []);
}
