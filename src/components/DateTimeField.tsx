import { StyleSheet, TextInput } from 'react-native';

export function DateTimeField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <TextInput value={value} onChangeText={onChange} style={styles.input} placeholder="2026/09/20 15:00" />;
}

const styles = StyleSheet.create({ input: { minHeight: 48, paddingHorizontal: 13, borderWidth: 1, borderColor: '#d9dde3', borderRadius: 11, backgroundColor: '#fff', fontSize: 16 } });
