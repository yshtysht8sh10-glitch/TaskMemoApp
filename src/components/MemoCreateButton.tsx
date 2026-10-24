import { Pressable, Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

/** Keep the status action reachable while creation itself remains guarded. */
export function MemoCreateButton({ editable, onCreate, onBlocked, style, textStyle }: {
  editable: boolean; onCreate: () => void; onBlocked: () => void;
  style?: StyleProp<ViewStyle>; textStyle?: StyleProp<TextStyle>;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel="新規作成"
    accessibilityHint={editable ? 'Memoを追加します' : '追加できない理由と同期状態を確認します'}
    style={[style, !editable && { opacity: 0.55 }]} onPress={editable ? onCreate : onBlocked}>
    <Text style={textStyle}>＋</Text>
  </Pressable>;
}
