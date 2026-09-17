import { useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

type Props<T> = {
  data: T[];
  keyFor: (item: T) => string;
  canDrag: (item: T) => boolean;
  renderItem: (item: T, active: boolean) => ReactNode;
  onHover: (active: T, target: T) => void;
  onDrop: (active: T, target: T) => void;
  contentContainerStyle?: object;
};

/**
 * Web fallback for react-native-draggable-flatlist.
 * The upstream gesture handler currently captures Safari's pan gesture and its
 * web drag path is broken. Native HTML drag keeps the whole card draggable
 * while leaving ordinary vertical swipes to the browser scroll container.
 */
export function WebSortableScrollList<T>({ data, keyFor, canDrag, renderItem, onHover, onDrop, contentContainerStyle }: Props<T>) {
  const activeRef = useRef<T | null>(null);
  const targetRef = useRef<T | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [targetKey, setTargetKey] = useState<string | null>(null);

  const finish = () => {
    const active = activeRef.current; const target = targetRef.current;
    activeRef.current = null; targetRef.current = null; setActiveKey(null); setTargetKey(null);
    if (active && target && keyFor(active) !== keyFor(target)) onDrop(active, target);
  };

  return <ScrollView style={styles.scroll} contentContainerStyle={contentContainerStyle} keyboardShouldPersistTaps="handled">
    {data.map((item, index) => {
      const key = keyFor(item);
      const opensBelow = targetKey === key && activeKey !== key;
      const opensAbove = targetKey !== null && data[index + 1] !== undefined && keyFor(data[index + 1]) === targetKey && activeKey !== key;
      const targetProps = {
        onDragEnter: (event: { preventDefault(): void }) => { event.preventDefault(); const active = activeRef.current; if (!active) return; targetRef.current = item; setTargetKey(key); onHover(active, item); },
        onDragOver: (event: { preventDefault(): void }) => event.preventDefault(),
        onDrop: (event: { preventDefault(): void }) => { event.preventDefault(); finish(); },
      };
      const dragProps = canDrag(item) ? {
        draggable: true,
        onDragStart: (event: { dataTransfer?: { effectAllowed: string; setData(type: string, value: string): void } }) => { activeRef.current = item; targetRef.current = item; setActiveKey(key); setTargetKey(null); if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', key); } },
        onDragEnd: finish,
      } : { draggable: false };
      return <div key={key} style={webStyles.slot}>
        {opensBelow && <div aria-hidden="true" style={webStyles.indicator} />}
        <div aria-label={canDrag(item) ? `${key}をドラッグして移動` : undefined} style={{ ...webStyles.row, ...(canDrag(item) ? webStyles.draggable : {}), ...(activeKey === key ? webStyles.active : {}), ...(opensBelow ? webStyles.openBelow : {}), ...(opensAbove ? webStyles.openAbove : {}) }} {...targetProps} {...dragProps}>
          <View style={styles.content}>{renderItem(item, activeKey === key)}</View>
        </div>
      </div>;
    })}
  </ScrollView>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1, touchAction: 'pan-y' },
  content: { flex: 1, minWidth: 0 },
});

const webStyles = {
  slot: { position: 'relative' },
  row: { position: 'relative', display: 'flex', alignItems: 'stretch', transition: 'transform 40ms cubic-bezier(.2,.8,.2,1)' },
  draggable: { cursor: 'grab' },
  active: { opacity: 0.55 },
  openAbove: { transform: 'translateY(-8px)' },
  openBelow: { transform: 'translateY(8px)' },
  indicator: { position: 'absolute', zIndex: 2, top: -2, left: 4, right: 4, height: 4, borderRadius: 2, background: '#5b8def', boxShadow: '0 0 0 3px rgba(91, 141, 239, 0.14)', pointerEvents: 'none' },
} as const;
