import { useEffect } from "react";
import { Platform } from "react-native";

import {
  focusedInputScrollOffset,
  focusedInputScrollPlan,
  focusedInputRevealPlan,
  normalizeVisibleViewport,
  shouldRevealFocusedInput,
  type VisibleViewport,
} from "@/utils/focusedInputVisibility";

const KEYBOARD_SETTLE_DELAYS = [80, 280];

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
  return new URLSearchParams(window.location.search).has("keyboardDiagnostics");
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
  if (!isTextEntry(element)) return;
  const layout = layoutViewport();
  const viewport = currentViewport(layout);
  if (!shouldRevealFocusedInput(viewport, layout)) return;
  const scrollContainer = scrollableAncestor(element);
  if (!scrollContainer) return;
  const reveal = focusedInputRevealPlan({
    baselineWindowScrollY,
    currentWindowScrollY: window.scrollY,
    inputBounds: element.getBoundingClientRect(),
    viewport,
    container: scrollContainer,
  });
  const scrollTopBefore = scrollContainer.scrollTop;
  logKeyboardGeometry("before-correction", element, scrollContainer, viewport, {
    baselineWindowScrollY,
    calculatedScrollOffset: reveal.containerScrollOffset,
    calculatedExtraBottomSpace: reveal.scroll.extraBottomSpace,
  });
  if (window.scrollY !== reveal.windowScrollTop)
    window.scrollTo(window.scrollX, reveal.windowScrollTop);
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
  applyOffset(reveal.containerScrollOffset);
  applyOffset(
    focusedInputScrollOffset(element.getBoundingClientRect(), currentViewport(layout)),
  );
  const finalViewport = currentViewport(layout);
  const finalBounds = element.getBoundingClientRect();
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
    const adjustedContainers = new Map<HTMLElement, { paddingBottom: string; scrollTop: number }>();
    let baselineWindowScrollY = window.scrollY;
    let pendingFocusWindowScrollY: number | null = null;
    let frame: number | null = null;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const scheduleReveal = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      timers.forEach(clearTimeout);
      timers.clear();
      frame = requestAnimationFrame(() => {
        const layout = layoutViewport();
        const visible = currentViewport(layout);
        if (shouldRevealFocusedInput(visible, layout))
          revealFocusedInput(adjustedContainers, baselineWindowScrollY);
        else {
          adjustedContainers.forEach((original, container) => {
            if (container.isConnected) {
              container.style.paddingBottom = original.paddingBottom;
              container.scrollTop = original.scrollTop;
            }
          });
          adjustedContainers.clear();
        }
        frame = null;
      });
      KEYBOARD_SETTLE_DELAYS.forEach((delay) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          revealFocusedInput(adjustedContainers, baselineWindowScrollY);
        }, delay);
        timers.add(timer);
      });
    };

    const capturePreFocusScroll = () => {
      pendingFocusWindowScrollY = window.scrollY;
    };
    const handleFocusIn = () => {
      baselineWindowScrollY = pendingFocusWindowScrollY ?? window.scrollY;
      pendingFocusWindowScrollY = null;
      const element = document.activeElement;
      if (isTextEntry(element)) {
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
      document.removeEventListener("pointerdown", capturePreFocusScroll, true);
      document.removeEventListener("focusin", handleFocusIn);
      viewport?.removeEventListener("resize", scheduleReveal);
      viewport?.removeEventListener("scroll", scheduleReveal);
      window.removeEventListener("resize", scheduleReveal);
      if (frame !== null) cancelAnimationFrame(frame);
      timers.forEach(clearTimeout);
      adjustedContainers.clear();
    };
  }, []);
}
