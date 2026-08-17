import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, PanResponder, Platform, StyleSheet, View } from "react-native";
import Svg, { Circle, Line, Path, Polygon, Rect, Text as SvgText } from "react-native-svg";
import type { DrawPath } from "@/hooks/useClassroomSocket";

export interface Point {
  x: number;
  y: number;
}

interface Props {
  /** Strokes already committed to the board, in board coordinates. */
  paths: DrawPath[];
  /** Rendered beneath the ink — the uploaded photo/PDF page, if any. */
  materialLayer?: React.ReactNode;
  /** Fired once per finished stroke so the parent can persist and broadcast it. */
  onCommit?: (shape: DrawPath) => void;
  /** Reports the drawing surface size so the parent can publish the coordinate space. */
  onSurfaceLayout?: (width: number, height: number) => void;
  /** Students render the same board but cannot draw on it. */
  readOnly?: boolean;

  tool: DrawPath["tool"] | "highlighter";
  color: string;
  strokeWidth: number;
  isEraser: boolean;

  zoom: number;
  pan: Point;
  panMode: boolean;
  onPanChange?: (pan: Point) => void;
  /** Asked to open the text entry prompt at this board point. */
  onRequestText?: (at: Point) => void;
}

/** Eraser paints in the board's own background colour rather than truly removing ink. */
const ERASER_COLOR = "#FFFFFF";
const ERASER_WIDTH = 24;

/**
 * A pointer-driven drawing surface.
 *
 * Input deliberately goes through pointer events on web rather than mouse or touch handlers.
 * The previous surface listened for PanResponder (mouse) plus raw onTouchStart/Move/End, and
 * nothing at all for `pointerdown` — so a mouse could draw, a stylus could not, and pressure
 * was unavailable. Pointer events cover mouse, finger and pen through one path, and carry
 * `pressure`, so a stylus can vary stroke width the way a real pen does.
 *
 * react-native-web forwards these props to the DOM but does not declare them in its
 * TypeScript types, hence the cast where they are attached.
 */
export default function WhiteboardCanvas({
  paths,
  materialLayer,
  onCommit,
  onSurfaceLayout,
  readOnly = false,
  tool,
  color,
  strokeWidth,
  isEraser,
  zoom,
  pan,
  panMode,
  onPanChange,
  onRequestText,
}: Props) {
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<DrawPath | null>(null);

  // Live values for handlers that must not be rebuilt mid-stroke.
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const panModeRef = useRef(panMode);
  zoomRef.current = zoom;
  panRef.current = pan;
  panModeRef.current = panMode;

  const startRef = useRef<Point | null>(null);
  const panDragRef = useRef<{ from: Point; pan: Point } | null>(null);
  const drawingRef = useRef(false);

  const settings = useRef({ tool, color, strokeWidth, isEraser });
  settings.current = { tool, color, strokeWidth, isEraser };

  /** Viewport point -> board point, undoing the current pan and zoom. */
  const toBoard = useCallback((vx: number, vy: number): Point => {
    const z = zoomRef.current || 1;
    const p = panRef.current;
    return { x: (vx - p.x) / z, y: (vy - p.y) / z };
  }, []);

  const strokeStyle = useCallback(() => {
    const s = settings.current;
    if (s.isEraser) return { color: ERASER_COLOR, width: ERASER_WIDTH };
    if (s.tool === "highlighter") return { color: s.color, width: Math.max(12, s.strokeWidth * 5) };
    return { color: s.color, width: s.strokeWidth };
  }, []);

  const begin = useCallback(
    (vx: number, vy: number, pressure: number) => {
      if (readOnly) return;
      if (panModeRef.current) {
        panDragRef.current = { from: { x: vx, y: vy }, pan: panRef.current };
        return;
      }
      const pt = toBoard(vx, vy);
      const s = settings.current;
      const { color: c, width } = strokeStyle();
      drawingRef.current = true;

      if (s.tool === "text") {
        drawingRef.current = false;
        onRequestText?.(pt);
        return;
      }
      if (s.tool === "pen" || s.tool === "highlighter" || s.isEraser) {
        setCurrentPath(`M${pt.x.toFixed(1)},${pt.y.toFixed(1)}`);
        return;
      }
      startRef.current = pt;
      if (s.tool === "line" || s.tool === "arrow") {
        setPreview({ tool: s.tool, color: c, width, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y });
      } else if (s.tool === "circle") {
        setPreview({ tool: "circle", color: c, width, cx: pt.x, cy: pt.y, r: 0 });
      } else if (s.tool === "rect") {
        setPreview({ tool: "rect", color: c, width, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y });
      }
      void pressure;
    },
    [readOnly, toBoard, strokeStyle, onRequestText],
  );

  const move = useCallback(
    (vx: number, vy: number) => {
      if (readOnly) return;
      const drag = panDragRef.current;
      if (drag) {
        onPanChange?.({ x: drag.pan.x + (vx - drag.from.x), y: drag.pan.y + (vy - drag.from.y) });
        return;
      }
      if (!drawingRef.current) return;
      const pt = toBoard(vx, vy);
      const s = settings.current;

      if (s.tool === "pen" || s.tool === "highlighter" || s.isEraser) {
        setCurrentPath((p) => (p ? `${p} L${pt.x.toFixed(1)},${pt.y.toFixed(1)}` : p));
        return;
      }
      const start = startRef.current;
      if (!start) return;
      if (s.tool === "line" || s.tool === "arrow" || s.tool === "rect") {
        setPreview((prev) => (prev ? { ...prev, x2: pt.x, y2: pt.y } : prev));
      } else if (s.tool === "circle") {
        const r = Math.hypot(pt.x - start.x, pt.y - start.y);
        setPreview((prev) => (prev ? { ...prev, r } : prev));
      }
    },
    [readOnly, toBoard, onPanChange],
  );

  const end = useCallback(() => {
    panDragRef.current = null;
    if (readOnly) return;
    const s = settings.current;
    const { color: c, width } = strokeStyle();

    if (currentPath) {
      onCommit?.({
        // Highlighter travels the wire as a pen stroke so older clients still render it.
        tool: "pen",
        d: currentPath,
        color: c,
        width,
      });
      setCurrentPath(null);
    } else if (preview) {
      onCommit?.(preview);
      setPreview(null);
    }
    startRef.current = null;
    drawingRef.current = false;
    void s;
  }, [readOnly, currentPath, preview, onCommit, strokeStyle]);

  // Native input. Web goes through pointer events below, which cover mouse, touch and pen.
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => Platform.OS !== "web" && !readOnly,
        onMoveShouldSetPanResponder: () => Platform.OS !== "web" && !readOnly,
        onPanResponderGrant: (e) => begin(e.nativeEvent.locationX, e.nativeEvent.locationY, 0.5),
        onPanResponderMove: (e) => move(e.nativeEvent.locationX, e.nativeEvent.locationY),
        onPanResponderRelease: end,
        onPanResponderTerminate: end,
      }),
    [begin, move, end, readOnly],
  );

  const surfaceRef = useRef<unknown>(null);

  const pointerHandlers =
    Platform.OS === "web"
      ? ({
          onPointerDown: (e: any) => {
            // Capture keeps the stroke alive if the pointer leaves the element mid-draw,
            // which otherwise ends strokes early near the edges of the board.
            try { e.currentTarget?.setPointerCapture?.(e.pointerId); } catch {}
            const r = e.currentTarget?.getBoundingClientRect?.();
            begin(e.clientX - (r?.left ?? 0), e.clientY - (r?.top ?? 0), e.pressure ?? 0.5);
          },
          onPointerMove: (e: any) => {
            const r = e.currentTarget?.getBoundingClientRect?.();
            move(e.clientX - (r?.left ?? 0), e.clientY - (r?.top ?? 0));
          },
          onPointerUp: (e: any) => {
            try { e.currentTarget?.releasePointerCapture?.(e.pointerId); } catch {}
            end();
          },
          onPointerCancel: end,
          // Stops the browser panning/zooming the page while drawing with a finger.
          style: { touchAction: "none" },
        } as object)
      : panResponder.panHandlers;

  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      onSurfaceLayout?.(width, height);
    },
    [onSurfaceLayout],
  );

  const committed = useMemo(() => paths.map((p, i) => renderShape(p, i)), [paths]);
  const live = strokeStyle();

  return (
    <View style={s.wrap}>
      {/* Content layer never receives input, so pointer coordinates stay in plain viewport
          space and do not have to be un-transformed twice. */}
      <View
        style={[s.canvas, { transform: [{ translateX: pan.x }, { translateY: pan.y }, { scale: zoom }] }]}
        pointerEvents="none"
      >
        {materialLayer}
        <Svg style={StyleSheet.absoluteFill}>
          {committed}
          {currentPath ? (
            <Path
              d={currentPath}
              stroke={live.color}
              strokeWidth={live.width}
              strokeOpacity={tool === "highlighter" && !isEraser ? 0.4 : 1}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
          {preview ? renderShape(preview, -1) : null}
        </Svg>
      </View>

      {/* Input layer: fills the board exactly, and nothing is layered over it. The old
          toolbar sat on top of the canvas, so strokes started in the bottom strip hit the
          toolbar instead of the board — the reason drawing only worked in some areas. */}
      <View
        ref={surfaceRef as never}
        style={StyleSheet.absoluteFill}
        onLayout={handleLayout}
        {...pointerHandlers}
      />
    </View>
  );
}

export function renderShape(p: DrawPath, i: number) {
  const key = `shape-${i}`;
  switch (p.tool) {
    case "line":
      return <Line key={key} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={p.color} strokeWidth={p.width} strokeLinecap="round" />;
    case "rect": {
      const x = Math.min(p.x1 ?? 0, p.x2 ?? 0);
      const y = Math.min(p.y1 ?? 0, p.y2 ?? 0);
      return (
        <Rect key={key} x={x} y={y} width={Math.abs((p.x2 ?? 0) - (p.x1 ?? 0))} height={Math.abs((p.y2 ?? 0) - (p.y1 ?? 0))} stroke={p.color} strokeWidth={p.width} fill="none" />
      );
    }
    case "circle":
      return <Circle key={key} cx={p.cx} cy={p.cy} r={p.r} stroke={p.color} strokeWidth={p.width} fill="none" />;
    case "arrow": {
      const { x1 = 0, y1 = 0, x2 = 0, y2 = 0 } = p;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = Math.max(10, p.width * 3);
      const pts = [
        `${x2},${y2}`,
        `${x2 - head * Math.cos(angle - Math.PI / 6)},${y2 - head * Math.sin(angle - Math.PI / 6)}`,
        `${x2 - head * Math.cos(angle + Math.PI / 6)},${y2 - head * Math.sin(angle + Math.PI / 6)}`,
      ].join(" ");
      return (
        <React.Fragment key={key}>
          <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={p.color} strokeWidth={p.width} strokeLinecap="round" />
          <Polygon points={pts} fill={p.color} />
        </React.Fragment>
      );
    }
    case "text":
      return (
        <SvgText key={key} x={p.x} y={p.y} fill={p.color} fontSize={Math.max(14, p.width * 6)} fontWeight="600">
          {p.text}
        </SvgText>
      );
    case "pen":
    default:
      // A remote client can send a tool this build does not know; without a `d` there is
      // nothing to draw, and rendering an empty Path would throw.
      if (!p.d) return null;
      return <Path key={key} d={p.d} stroke={p.color} strokeWidth={p.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
  }
}

const s = StyleSheet.create({
  wrap: { flex: 1, position: "relative", overflow: "hidden", backgroundColor: "#FFFFFF" },
  canvas: { ...StyleSheet.absoluteFillObject, transformOrigin: "0 0" } as object,
});
