import { View } from 'react-native';
/** Tintable on Web and mobile without an icon dependency. */
export function FolderIcon({ color }: { color: string }) {
  return <View style={{ width: 25, height: 20, alignItems: 'center', justifyContent: 'center' }}>
    <View style={{ position: 'absolute', top: 2, left: 3, width: 9, height: 5, borderRadius: 2, backgroundColor: color }} />
    <View style={{ width: 19, height: 13, marginTop: 3, borderRadius: 2, backgroundColor: color }} />
  </View>;
}
