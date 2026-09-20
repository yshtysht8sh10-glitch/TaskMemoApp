import { useCallback, useEffect, useRef, useState, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react';
import { StyleSheet, View } from 'react-native';
import { createDragAutoScroller } from '@/domain/dragAutoScroll';
import { exceedsWebTouchDragTolerance, WEB_DRAG_ACTIVATION_DELAY_MS, webTouchDragOverlayPosition } from '@/domain/dragActivation';

type Props<T> = {
  data: T[];
  header?: ReactNode;
  keyFor: (item: T) => string;
  canDrag: (item: T) => boolean;
  renderItem: (item: T, active: boolean) => ReactNode;
  onHover: (active: T, target: T, placement: 'before' | 'on' | 'after') => void;
  onDrop: (active: T, target: T, placement: 'before' | 'on' | 'after') => void;
  canDropAfter?: (item: T) => boolean;
  contentContainerStyle?: object;
  /** Disable targets that supply their own drop indicator. */
  showDropIndicator?: boolean | ((active: T, target: T) => boolean);
  /** Treat the top quarter of a row as its preceding insertion gap. */
  distinguishBeforeTarget?: boolean;
};

/**
 * Web fallback for react-native-draggable-flatlist.
 * The upstream gesture handler currently captures Safari's pan gesture and its
 * web drag path is broken. Native HTML drag keeps the whole card draggable
 * while leaving ordinary vertical swipes to the browser scroll container.
 */
export function WebSortableScrollList<T>({ data, header, keyFor, canDrag, renderItem, onHover, onDrop, contentContainerStyle, showDropIndicator = true, distinguishBeforeTarget = false, canDropAfter }: Props<T>) {
  const activeRef = useRef<T | null>(null);
  const targetRef = useRef<T | null>(null);
  const placementRef = useRef<'before' | 'on' | 'after'>('before');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const refreshTargetRef = useRef(() => {});
  const autoScrollerRef = useRef<ReturnType<typeof createDragAutoScroller> | null>(null);
  const touchGestureRef = useRef<{
    identifier: number;
    startX: number;
    startY: number;
    timer: ReturnType<typeof setTimeout>;
    active: boolean;
    removeListeners: () => void;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const touchOverlayRef = useRef<HTMLDivElement | null>(null);
  const touchOverlayOffsetRef = useRef({ x: 0, y: 0 });
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const [placement, setPlacement] = useState<'before' | 'on' | 'after'>('before');

  useEffect(() => {
    const scroller = createDragAutoScroller({
      bounds: () => scrollRef.current?.getBoundingClientRect() ?? null,
      scrollBy: (delta) => scrollRef.current?.scrollBy({ top: delta }),
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (id) => cancelAnimationFrame(id),
      afterScroll: () => refreshTargetRef.current(),
    });
    autoScrollerRef.current = scroller;
    return () => {
      scroller.stop();
      if (touchGestureRef.current) {
        clearTimeout(touchGestureRef.current.timer);
        touchGestureRef.current.removeListeners();
      }
      touchGestureRef.current = null;
      touchOverlayRef.current?.remove();
      touchOverlayRef.current = null;
      autoScrollerRef.current = null;
    };
  }, []);

  const finish = (commit = true) => {
    const active = activeRef.current; const target = targetRef.current;
    autoScrollerRef.current?.stop();
    touchOverlayRef.current?.remove();
    touchOverlayRef.current = null;
    activeRef.current = null; targetRef.current = null; setActiveKey(null); setTargetKey(null);
    if (commit && active && target && keyFor(active) !== keyFor(target)) onDrop(active, target, placementRef.current);
  };
  const begin = (item: T, key: string, clientX: number, clientY: number) => {
    activeRef.current = item; targetRef.current = item; placementRef.current = 'before';
    pointerRef.current = { x: clientX, y: clientY };
    autoScrollerRef.current?.start(clientY);
    setPlacement('before'); setActiveKey(key); setTargetKey(null);
  };
  const showTouchOverlay = (element: HTMLDivElement, clientX: number, clientY: number) => {
    const bounds = element.getBoundingClientRect();
    const overlay = element.cloneNode(true) as HTMLDivElement;
    overlay.draggable = false;
    overlay.removeAttribute('id');
    overlay.querySelectorAll('[id]').forEach((child) => child.removeAttribute('id'));
    overlay.setAttribute('aria-hidden', 'true');
    Object.assign(overlay.style, {
      position: 'fixed',
      zIndex: '9999',
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
      margin: '0',
      pointerEvents: 'none',
      opacity: '0.94',
      transform: 'scale(1.025)',
      transformOrigin: 'center',
      boxShadow: '0 10px 26px rgba(0, 0, 0, 0.24)',
      willChange: 'left, top',
    });
    touchOverlayOffsetRef.current = { x: clientX - bounds.left, y: clientY - bounds.top };
    const position = webTouchDragOverlayPosition(clientX, clientY, touchOverlayOffsetRef.current.x, touchOverlayOffsetRef.current.y);
    overlay.style.left = `${position.left}px`;
    overlay.style.top = `${position.top}px`;
    document.body.appendChild(overlay);
    touchOverlayRef.current = overlay;
  };
  const moveTouchOverlay = (clientX: number, clientY: number) => {
    const overlay = touchOverlayRef.current;
    if (!overlay) return;
    const position = webTouchDragOverlayPosition(clientX, clientY, touchOverlayOffsetRef.current.x, touchOverlayOffsetRef.current.y);
    overlay.style.left = `${position.left}px`;
    overlay.style.top = `${position.top}px`;
  };
  const activeItem =
    activeKey === null
      ? null
      : (data.find((item) => keyFor(item) === activeKey) ?? null);

  const updateTarget = useCallback((item: T, key: string, clientY: number, currentTarget: { getBoundingClientRect(): { top: number; height: number } }) => {
    const active = activeRef.current; if (!active) return;
    const bounds = currentTarget.getBoundingClientRect();
    const nextPlacement = canDropAfter?.(item)
      ? clientY >= bounds.top + bounds.height / 2 ? 'after' : 'before'
      : distinguishBeforeTarget && clientY <= bounds.top + bounds.height * 0.25 ? 'before' : distinguishBeforeTarget ? 'on' : 'before';
    targetRef.current = item; placementRef.current = nextPlacement; setTargetKey(key); setPlacement(nextPlacement); onHover(active, item, nextPlacement);
  }, [canDropAfter, distinguishBeforeTarget, onHover]);
  useEffect(() => {
    refreshTargetRef.current = () => {
      if (!activeRef.current || typeof document === 'undefined') return;
      const element = document.elementFromPoint(pointerRef.current.x, pointerRef.current.y)?.closest<HTMLElement>('[data-taskmemo-dnd-key]');
      const key = element?.dataset.taskmemoDndKey;
      const item = key ? data.find((candidate) => keyFor(candidate) === key) : undefined;
      if (item && element) updateTarget(item, key!, pointerRef.current.y, element);
    };
  }, [data, keyFor, updateTarget]);

  return <div ref={scrollRef} style={webStyles.scroll}
    onDragOver={(event) => { event.preventDefault(); pointerRef.current = { x: event.clientX, y: event.clientY }; autoScrollerRef.current?.update(event.clientY); }}>
    <View style={contentContainerStyle}>
    {header}
    {data.map((item, index) => {
      const key = keyFor(item);
      const showForTarget =
        typeof showDropIndicator === 'function'
          ? !!activeItem && showDropIndicator(activeItem, item)
          : showDropIndicator;
      const opensBelow = showForTarget && targetKey === key && activeKey !== key && placement === 'before';
      const nextItem = data[index + 1];
      const showForNextTarget =
        nextItem && typeof showDropIndicator === 'function'
          ? !!activeItem && showDropIndicator(activeItem, nextItem)
          : showDropIndicator;
      const opensAbove = showForNextTarget && placement === 'before' && targetKey !== null && nextItem !== undefined && keyFor(nextItem) === targetKey && activeKey !== key;
      const targetProps = {
        onDragEnter: (event: { preventDefault(): void; clientY: number; currentTarget: { getBoundingClientRect(): { top: number; height: number } } }) => { event.preventDefault(); updateTarget(item, key, event.clientY, event.currentTarget); },
        onDragOver: (event: { preventDefault(): void; clientX: number; clientY: number; currentTarget: { getBoundingClientRect(): { top: number; height: number } } }) => { event.preventDefault(); pointerRef.current = { x: event.clientX, y: event.clientY }; autoScrollerRef.current?.update(event.clientY); updateTarget(item, key, event.clientY, event.currentTarget); },
        onDrop: (event: { preventDefault(): void }) => { event.preventDefault(); finish(); },
      };
      const dragProps = canDrag(item) ? {
        draggable: true,
        onDragStart: (event: { clientX: number; clientY: number; dataTransfer?: { effectAllowed: string; setData(type: string, value: string): void } }) => { begin(item, key, event.clientX, event.clientY); if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', key); } },
        onDragEnd: () => finish(),
        onTouchStart: (event: ReactTouchEvent<HTMLDivElement>) => {
          if (touchGestureRef.current || event.touches.length !== 1) return;
          const touch = event.touches[0];
          const element = event.currentTarget;
          const findTouch = (touches: TouchList, identifier: number) => Array.from(touches).find((candidate) => candidate.identifier === identifier);
          const cleanup = () => {
            element.draggable = true;
            document.removeEventListener('touchmove', move, true);
            document.removeEventListener('touchend', end, true);
            document.removeEventListener('touchcancel', cancel, true);
          };
          const clearGesture = () => {
            const current = touchGestureRef.current;
            if (current) clearTimeout(current.timer);
            cleanup();
            touchGestureRef.current = null;
          };
          const move = (nativeEvent: TouchEvent) => {
            const gesture = touchGestureRef.current;
            if (!gesture) return;
            const currentTouch = findTouch(nativeEvent.touches, gesture.identifier);
            if (!currentTouch) return;
            pointerRef.current = { x: currentTouch.clientX, y: currentTouch.clientY };
            if (!gesture.active) {
              if (exceedsWebTouchDragTolerance(gesture.startX, gesture.startY, currentTouch.clientX, currentTouch.clientY)) clearGesture();
              return;
            }
            nativeEvent.preventDefault();
            moveTouchOverlay(currentTouch.clientX, currentTouch.clientY);
            autoScrollerRef.current?.update(currentTouch.clientY);
            refreshTargetRef.current();
          };
          const end = (nativeEvent: TouchEvent) => {
            const gesture = touchGestureRef.current;
            if (!gesture || !findTouch(nativeEvent.changedTouches, gesture.identifier)) return;
            const wasActive = gesture.active;
            clearGesture();
            if (!wasActive) return;
            nativeEvent.preventDefault();
            finish();
            setTimeout(() => { suppressClickRef.current = false; }, 0);
          };
          const cancel = () => {
            const wasActive = touchGestureRef.current?.active ?? false;
            clearGesture();
            if (wasActive) finish(false);
          };
          const gesture = {
            identifier: touch.identifier,
            startX: touch.clientX,
            startY: touch.clientY,
            timer: setTimeout(() => {
              const current = touchGestureRef.current;
              if (!current || current.identifier !== touch.identifier) return;
              current.active = true;
              suppressClickRef.current = true;
              element.draggable = false;
              begin(item, key, pointerRef.current.x, pointerRef.current.y);
              showTouchOverlay(element, pointerRef.current.x, pointerRef.current.y);
            }, WEB_DRAG_ACTIVATION_DELAY_MS),
            active: false,
            removeListeners: cleanup,
          };
          pointerRef.current = { x: touch.clientX, y: touch.clientY };
          touchGestureRef.current = gesture;
          document.addEventListener('touchmove', move, { passive: false, capture: true });
          document.addEventListener('touchend', end, { passive: false, capture: true });
          document.addEventListener('touchcancel', cancel, { capture: true });
        },
        onClickCapture: (event: { preventDefault(): void; stopPropagation(): void }) => {
          if (!suppressClickRef.current) return;
          suppressClickRef.current = false;
          event.preventDefault();
          event.stopPropagation();
        },
      } : { draggable: false };
      return <div key={key} data-taskmemo-dnd-key={key} style={webStyles.slot} {...targetProps}>
        {opensBelow && <div aria-hidden="true" style={webStyles.indicator} />}
        {showForTarget && targetKey === key && activeKey !== key && placement === 'after' && <div aria-hidden="true" style={{ ...webStyles.indicator, top: 'auto', bottom: -2 }} />}
        <div aria-label={canDrag(item) ? `${key}をドラッグして移動` : undefined} style={{ ...webStyles.row, ...(canDrag(item) ? webStyles.draggable : {}), ...(activeKey === key ? webStyles.active : {}), ...(opensBelow ? webStyles.openBelow : {}), ...(opensAbove ? webStyles.openAbove : {}) }} {...dragProps}>
          <View style={styles.content}>{renderItem(item, activeKey === key)}</View>
        </div>
      </div>;
    })}
    </View>
  </div>;
}

const styles = StyleSheet.create({
  content: { flex: 1, minWidth: 0 },
});

const webStyles = {
  scroll: { flex: 1, minHeight: 0, overflowY: 'auto', touchAction: 'pan-y' },
  slot: { position: 'relative' },
  row: { position: 'relative', display: 'flex', alignItems: 'stretch', transition: 'transform 40ms cubic-bezier(.2,.8,.2,1)' },
  draggable: { cursor: 'grab' },
  active: { opacity: 0.55 },
  openAbove: { transform: 'translateY(-8px)' },
  openBelow: { transform: 'translateY(8px)' },
  indicator: { position: 'absolute', zIndex: 2, top: -2, left: 4, right: 4, height: 4, borderRadius: 2, background: '#5b8def', boxShadow: '0 0 0 3px rgba(91, 141, 239, 0.14)', pointerEvents: 'none' },
} as const;
