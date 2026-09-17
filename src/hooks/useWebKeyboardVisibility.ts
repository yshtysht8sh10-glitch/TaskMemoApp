import { useEffect, useState } from "react";
import { Platform } from "react-native";

import {
  focusedInputScrollOffset,
  type VisibleViewport,
} from "@/utils/focusedInputVisibility";

const KEYBOARD_SETTLE_DELAYS = [80, 280];

function currentViewport(): VisibleViewport {
  const viewport = window.visualViewport;
  return {
    height: viewport?.height ?? window.innerHeight,
    offsetTop: viewport?.offsetTop ?? 0,
  };
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
  let ancestor = element.parentElement;
  while (ancestor) {
    const overflowY = window.getComputedStyle(ancestor).overflowY;
    if (/auto|scroll/.test(overflowY)) return ancestor;
    ancestor = ancestor.parentElement;
  }
  return null;
}

function revealFocusedInput() {
  const element = document.activeElement;
  if (!isTextEntry(element)) return;
  const offset = focusedInputScrollOffset(
    element.getBoundingClientRect(),
    currentViewport(),
  );
  if (!offset) return;
  const scrollContainer = scrollableAncestor(element);
  if (scrollContainer) scrollContainer.scrollTop += offset;
}

export function useWebFocusedInputVisibility() {
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const viewport = window.visualViewport;
    let frame: number | null = null;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const scheduleReveal = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      timers.forEach(clearTimeout);
      timers.clear();
      frame = requestAnimationFrame(() => {
        revealFocusedInput();
        frame = null;
      });
      KEYBOARD_SETTLE_DELAYS.forEach((delay) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          revealFocusedInput();
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
    };
  }, []);
}

export function useWebVisualViewportHeight() {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const viewport = window.visualViewport;
    const update = () => {
      const next = Math.round(viewport?.height ?? window.innerHeight);
      if (next > 0) setHeight(next);
    };
    update();
    viewport?.addEventListener("resize", update);
    window.addEventListener("resize", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return height;
}
