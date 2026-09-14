import { Alert, Platform, type AlertButton } from 'react-native';

/** Alert.alert is a no-op in react-native-web, so keep confirmations usable there. */
export function appAlert(title: string, message?: string, buttons?: AlertButton[]) {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons);
    return;
  }

  const text = message ? `${title}\n\n${message}` : title;
  if (!buttons?.length) {
    window.alert(text);
    return;
  }

  const actions = buttons.filter((button) => button.style !== 'cancel');
  if (!window.confirm(text)) return;

  if (actions.length === 1) {
    actions[0].onPress?.();
    return;
  }

  // Alert.alert can expose two non-cancel choices on native. A second confirm
  // preserves that choice on Safari without introducing a separate web UI.
  const [first, second] = actions;
  const chooseSecond = window.confirm(`${second.text} を選びますか？\n\n「キャンセル」で ${first.text} を選びます。`);
  (chooseSecond ? second : first).onPress?.();
}
