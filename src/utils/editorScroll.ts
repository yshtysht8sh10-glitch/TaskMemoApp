// react-native-web's on-drag handler blurs on every scroll, including IME and programmatic scrolling.
export function editorKeyboardDismissMode(platform: string): 'interactive' | 'on-drag' | 'none' {
  return platform === 'web' ? 'none' : platform === 'ios' ? 'interactive' : 'on-drag';
}
