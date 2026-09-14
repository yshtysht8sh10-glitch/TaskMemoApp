import { StyleSheet, TextInput } from 'react-native';
import { useAppTheme, type ThemeColors } from '@/theme/theme';

export function DateTimeField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { colors } = useAppTheme(); const styles = createStyles(colors);
  return <TextInput value={value} onChangeText={onChange} style={styles.input} placeholderTextColor={colors.textSecondary} placeholder="2026/09/20 15:00" />;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({ input: { minHeight: 48, paddingHorizontal: 13, borderWidth: 1, borderColor: colors.border, borderRadius: 11, backgroundColor: colors.surface, color: colors.text, fontSize: 16 } });
