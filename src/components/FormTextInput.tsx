import { forwardRef } from 'react';
import { Platform, StyleSheet, TextInput, type TextInputProps } from 'react-native';
import { formFontSize } from '../theme/formTypography';

/** Apply the Web minimum after caller styles; retain native styles, refs and input events. */
export const FormTextInput = forwardRef<TextInput, TextInputProps>(function FormTextInput({ style, ...props }, ref) {
  const fontSize = formFontSize(Platform.OS, StyleSheet.flatten(style)?.fontSize);
  return <TextInput {...props} ref={ref} style={Platform.OS === 'web' ? [style, { fontSize }] : style} />;
});
