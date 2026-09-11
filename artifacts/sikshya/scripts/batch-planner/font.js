const injected = new Set();
export async function loadAsync(map, value) {
  for (const [family, source] of Object.entries(typeof map === "string" ? { [map]: value } : map)) {
    if (injected.has(family)) continue;
    const url = typeof source === "string" ? source : source?.uri ?? source?.default;
    if (!url) continue;
    const style = document.createElement("style");
    style.textContent = `@font-face{font-family:'${family}';src:url('${url}')}`;
    document.head.appendChild(style);
    injected.add(family);
  }
}
export const isLoaded = (family) => injected.has(family);
export const isLoading = () => false;
export const processFontFamily = (name) => name;
export const getLoadedFonts = () => [...injected];
