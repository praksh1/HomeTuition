import { useEffect, useState } from "react";
import { Platform, useWindowDimensions } from "react-native";

/**
 * Mobile browser keyboards can cover fixed UI without resizing the layout viewport.
 * Follow the visible bounds while a surface is open; native keeps KeyboardAvoidingView.
 * Do not counteract the user's pinch zoom or keep listeners running on closed surfaces.
 */
export function useVisibleViewport(active: boolean) {
  const { height } = useWindowDimensions();
  const [visible, setVisible] = useState<{ height: number; top: number } | null>(null);

  useEffect(() => {
    if (!active || Platform.OS !== "web" || typeof window === "undefined") {
      setVisible(null);
      return;
    }
    const viewport = window.visualViewport;
    if (!viewport) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (Math.abs(viewport.scale - 1) > 0.01 || viewport.height <= 0) {
        setVisible(null);
        return;
      }
      const next = { height: Math.round(viewport.height), top: Math.max(0, Math.round(viewport.offsetTop)) };
      setVisible((current) => current?.height === next.height && current.top === next.top ? current : next);
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(measure); };
    measure();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    return () => {
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [active]);

  return visible ?? { height, top: 0 };
}
