/** The four locally bundled interface faces; weights are real faces, not synthetic bold. */
export const interfaceFonts = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;

export type InterfaceFontWeight = keyof typeof interfaceFonts;

/**
 * A native font name must remain bare. Only browsers understand a CSS fallback stack.
 * These Nepali-capable fallbacks are local system fonts: no extra download or font service.
 */
export function interfaceFontFamily(weight: InterfaceFontWeight, platform: string): string {
  const inter = interfaceFonts[weight];
  if (platform !== "web") return inter;
  return `${inter}, "Noto Sans Devanagari", "Kohinoor Devanagari", "Nirmala UI", "Mangal", ui-sans-serif, system-ui, sans-serif`;
}
