import { useEffect } from "react";
import { Platform } from "react-native";

import {
  focusedInputScrollOffset,
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

function revealFocusedInput(
  adjustedContainers: Map<HTMLElement, number>,
) {
  const element = document.activeElement;
  if (!isTextEntry(element)) return;
  const layout = layoutViewport();
  const viewport = currentViewport(layout);
  if (!shouldRevealFocusedInput(viewport, layout)) return;
  const offset = focusedInputScrollOffset(
    element.getBoundingClientRect(),
    viewport,
  );
  if (!offset) return;
  const scrollContainer = scrollableAncestor(element);
  if (scrollContainer) {
    if (!adjustedContainers.has(scrollContainer))
      adjustedContainers.set(scrollContainer, scrollContainer.scrollTop);
    scrollContainer.scrollTop += offset;
  }
}

export function useWebFocusedInputVisibility() {
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const viewport = window.visualViewport;
    const adjustedContainers = new Map<HTMLElement, number>();
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
          revealFocusedInput(adjustedContainers);
        else {
          adjustedContainers.forEach((scrollTop, container) => {
            if (container.isConnected) container.scrollTop = scrollTop;
          });
          adjustedContainers.clear();
        }
        frame = null;
      });
      KEYBOARD_SETTLE_DELAYS.forEach((delay) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          revealFocusedInput(adjustedContainers);
        }, delay);
        timers.add(timer);
      });
    };

    document.addEventListener("focusin", scheduleReveal);
    viewport?.addEventListener("resize", scheduleReveal);
    viewport?.addEventListener("scroll", scheduleReveal);
    window.addEventListener("resize", scheduleReveal);
    return () => {
      document.removeEventListener("focusin", scheduleReveal);
      viewport?.removeEventListener("resize", scheduleReveal);
      viewport?.removeEventListener("scroll", scheduleReveal);
      window.removeEventListener("resize", scheduleReveal);
      if (frame !== null) cancelAnimationFrame(frame);
      timers.forEach(clearTimeout);
      adjustedContainers.clear();
    };
  }, []);
}
