import { useCallback, useEffect, useRef } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

import { currentTreeTraceId, treeDiagnosticLog } from './treeDiagnostics';

const measuredHeights = new Map<string, number>();
const rowMeasurers = new Map<string, (reason: 'layout' | 'render' | 'release' | 'drop') => void>();

export function measureAllTreeRows(reason: 'release' | 'drop') {
  rowMeasurers.forEach((measure) => measure(reason));
}

type Props = {
  rowKey: string;
  index: number;
  orderedKeys: string[];
  viewportRef: React.RefObject<View | null>;
  scrollOffsetRef: React.RefObject<number>;
  revision: string;
  children: React.ReactNode;
};

export function TreeRowDiagnostics({ rowKey, index, orderedKeys, viewportRef, scrollOffsetRef, revision, children }: Props) {
  const rowRef = useRef<View>(null);
  const measure = useCallback((reason: 'layout' | 'render' | 'release' | 'drop') => {
    if (!__DEV__) return;
    requestAnimationFrame(() => viewportRef.current?.measureInWindow((_vx, viewportY) => rowRef.current?.measureInWindow((x, actualY, width, height) => {
      const preceding = orderedKeys.slice(0, index).map((key) => measuredHeights.get(key));
      const completeMeasurements = preceding.every((value) => value !== undefined);
      const expectedY = completeMeasurements ? viewportY + 6 + preceding.reduce<number>((sum, value) => sum + (value ?? 0), 0) - scrollOffsetRef.current : null;
      treeDiagnosticLog('row-coordinate', { reason, measuredTraceId: currentTreeTraceId(), key: rowKey, index, x, actualY, width, height, viewportY, scrollOffset: scrollOffsetRef.current, expectedY, inferredAnimatedTransformY: expectedY === null ? null : actualY - expectedY, completeMeasurements });
    })));
  }, [index, orderedKeys, rowKey, scrollOffsetRef, viewportRef]);
  const onLayout = (event: LayoutChangeEvent) => { measuredHeights.set(rowKey, event.nativeEvent.layout.height); measure('layout'); };
  useEffect(() => { rowMeasurers.set(rowKey, measure); return () => { if (rowMeasurers.get(rowKey) === measure) rowMeasurers.delete(rowKey); }; }, [measure, rowKey]);
  useEffect(() => { measure('render'); }, [measure, revision]);
  return <View ref={rowRef} collapsable={false} onLayout={onLayout}>{children}</View>;
}
