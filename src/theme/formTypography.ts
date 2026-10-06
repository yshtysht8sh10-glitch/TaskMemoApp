/** Web focusable text controls share this minimum; native typography is unchanged. */
export const WEB_FORM_MIN_FONT_SIZE = 16;
export function formFontSize(platform: string, requested?: number): number | undefined {
  return platform === 'web' ? Math.max(WEB_FORM_MIN_FONT_SIZE, requested ?? WEB_FORM_MIN_FONT_SIZE) : requested;
}
export const webFormTypography = { fontSize: formFontSize('web')! };
