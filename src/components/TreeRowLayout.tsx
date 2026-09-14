import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAppTheme, type ThemeColors } from '@/theme/theme';
import { visibleAncestorGuides } from '@/domain/treeView';

export const TREE_LAYOUT = {
  depthIndent: 22,
  guideXOffset: 9,
  iconWidth: 22,
  maxVisibleDepth: 5,
} as const;

export function nodeLeftForDepth(depth: number) {
  return Math.min(depth, TREE_LAYOUT.maxVisibleDepth) * TREE_LAYOUT.depthIndent;
}

export function TreeRowLayout({ depth, ancestorContinuation, hasNextSibling, children }: { depth: number; ancestorContinuation: boolean[]; hasNextSibling: boolean; children: ReactNode }) {
  const styles = createStyles(useAppTheme().colors);
  const hiddenLevels = Math.max(0, depth - TREE_LAYOUT.maxVisibleDepth);
  const visibleDepth = Math.min(depth, TREE_LAYOUT.maxVisibleDepth);
  const ancestorGuides = visibleAncestorGuides(depth, ancestorContinuation, TREE_LAYOUT.maxVisibleDepth);
  return <View style={styles.container}>
    {ancestorGuides.map((continues, index) => continues ? <View key={hiddenLevels + index + 1} style={[styles.vertical, { left: index * TREE_LAYOUT.depthIndent + TREE_LAYOUT.guideXOffset }]} /> : null)}
    {visibleDepth > 0 && <>
      <View style={[styles.vertical, hasNextSibling ? styles.full : styles.topHalf, { left: (visibleDepth - 1) * TREE_LAYOUT.depthIndent + TREE_LAYOUT.guideXOffset }]} />
      <View style={[styles.horizontal, { left: (visibleDepth - 1) * TREE_LAYOUT.depthIndent + TREE_LAYOUT.guideXOffset, width: TREE_LAYOUT.depthIndent - TREE_LAYOUT.guideXOffset }]} />
    </>}
    <View style={{ marginLeft: nodeLeftForDepth(depth) }}>{children}</View>
  </View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { position: 'relative' },
  vertical: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: colors.guide },
  full: {},
  topHalf: { bottom: '50%' },
  horizontal: { position: 'absolute', top: '50%', height: StyleSheet.hairlineWidth, backgroundColor: colors.guide },
});
