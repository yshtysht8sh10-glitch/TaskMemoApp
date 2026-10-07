import type { RefObject } from 'react';
import type { TextInput } from 'react-native';
export type EditorResizeProps = { editor: RefObject<TextInput | null>; disabled: boolean };
/** Native apps do not use the Web textarea resize control. */
export function EditorResizeHandle(_props: EditorResizeProps) { return null; }
