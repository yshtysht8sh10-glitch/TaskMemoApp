export function selectedChoiceStyle(colors: { accent: string; accentSoft: string }) {
  return {
    container: {
      borderWidth: 1,
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    label: { color: colors.accent, fontWeight: '700' as const },
  };
}
