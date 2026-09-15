import React, { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { useColors } from "@/hooks/useColors";

interface Props {
  uri: string;
  style?: StyleProp<ViewStyle>;
  zoom?: number;
}

interface PdfViewport { width: number; height: number }
interface PdfPageProxy {
  getViewport(options: { scale: number }): PdfViewport;
  render(options: {
    canvas: HTMLCanvasElement;
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewport;
  }): { promise: Promise<void>; cancel(): void };
  cleanup(): void;
}
interface PdfDocumentProxy {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageProxy>;
  destroy(): Promise<void>;
}

const MAX_PREVIEW_PAGES = 100;

function PdfPage({ document, pageNumber, total }: {
  document: PdfDocumentProxy;
  pageNumber: number;
  total: number;
}) {
  const colors = useColors();
  const stage = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [near, setNear] = useState(pageNumber <= 2);
  const [ratio, setRatio] = useState(1 / 1.414);
  const [problem, setProblem] = useState(false);

  useEffect(() => {
    const element = stage.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setNear(Boolean(entry?.isIntersecting)),
      { rootMargin: "900px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const target = canvas.current;
    if (!target || !near) {
      if (target) { target.width = 1; target.height = 1; }
      return;
    }

    let cancelled = false;
    let page: PdfPageProxy | null = null;
    let task: ReturnType<PdfPageProxy["render"]> | null = null;
    void (async () => {
      try {
        page = await document.getPage(pageNumber);
        if (cancelled || !stage.current || !canvas.current) return;
        const base = page.getViewport({ scale: 1 });
        setRatio(base.width / base.height);
        const cssWidth = Math.max(280, stage.current.clientWidth);
        const pixelWidth = Math.min(1400, Math.ceil(cssWidth * Math.min(window.devicePixelRatio || 1, 2)));
        const viewport = page.getViewport({ scale: pixelWidth / base.width });
        const context = canvas.current.getContext("2d");
        if (!context) throw new Error("Canvas unavailable");
        canvas.current.width = Math.max(1, Math.round(viewport.width));
        canvas.current.height = Math.max(1, Math.round(viewport.height));
        task = page.render({ canvas: canvas.current, canvasContext: context, viewport });
        await task.promise;
      } catch (error) {
        if (!cancelled && (error as { name?: string })?.name !== "RenderingCancelledException") setProblem(true);
      }
    })();

    return () => {
      cancelled = true;
      try { task?.cancel(); } catch { /* already finished */ }
      page?.cleanup();
    };
  }, [document, near, pageNumber]);

  return (
    <div
      ref={stage}
      data-testid={`pdf-page-${pageNumber}`}
      style={{ width: "100%", aspectRatio: ratio, background: colors.card, border: `1px solid ${colors.border}`, position: "relative" }}
    >
      <canvas ref={canvas} aria-label={`Page ${pageNumber} of ${total}`} style={{ width: "100%", height: "100%", display: "block" }} />
      {problem ? (
        <div role="alert" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: colors.destructive, padding: 24, textAlign: "center" }}>
          Page {pageNumber} could not be displayed. You can still download the document.
        </div>
      ) : null}
      <span style={{ position: "absolute", right: 10, bottom: 8, borderRadius: 999, background: colors.secondary, color: colors.onInverse, padding: "3px 8px", font: "12px system-ui" }}>
        {pageNumber} / {total}
      </span>
    </div>
  );
}

/**
 * A real paged PDF reader for the web.
 *
 * Safari renders only the first page of many PDFs embedded in an iframe. pdf.js renders the
 * pages itself from Fadko's worker. Only nearby pages are rasterized so a long handout does
 * not become dozens of full-size canvases in phone memory.
 */
export default function PdfViewer({ uri, style, zoom = 1 }: Props) {
  const flat = (StyleSheet.flatten(style) as React.CSSProperties) ?? {};
  const [document, setDocument] = useState<PdfDocumentProxy | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let loaded: PdfDocumentProxy | null = null;
    let loadingTask: { promise: Promise<PdfDocumentProxy>; destroy?(): Promise<void> } | null = null;
    setDocument(null);
    setProblem(null);

    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        if (!pdfjs.GlobalWorkerOptions.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = `${window.location.origin}/pdf.worker.min.js`;
        }
        loadingTask = pdfjs.getDocument({ url: uri, isEvalSupported: false, disableAutoFetch: true }) as unknown as typeof loadingTask;
        loaded = await loadingTask!.promise;
        if (alive) setDocument(loaded);
      } catch {
        if (alive) setProblem("This PDF could not be displayed. You can still download it.");
      }
    })();

    return () => {
      alive = false;
      if (loadingTask?.destroy) void loadingTask.destroy();
      else void loaded?.destroy();
    };
  }, [uri]);

  const total = Math.min(document?.numPages ?? 0, MAX_PREVIEW_PAGES);
  return (
    <div data-testid="pdf-document" style={{ ...flat, overflow: "auto", WebkitOverflowScrolling: "touch" }}>
      {problem ? <div role="alert" style={{ padding: 24, textAlign: "center" }}>{problem}</div> : null}
      {!problem && !document ? <div style={{ padding: 24, textAlign: "center" }}>Preparing all pages…</div> : null}
      {document ? (
        <div style={{ width: `${Math.round(Math.max(0.75, zoom) * 100)}%`, minWidth: "100%", display: "flex", flexDirection: "column", gap: 12, padding: 12, boxSizing: "border-box" }}>
          {Array.from({ length: total }, (_, index) => (
            <PdfPage key={index + 1} document={document} pageNumber={index + 1} total={document.numPages} />
          ))}
          {document.numPages > MAX_PREVIEW_PAGES ? (
            <div style={{ padding: 16, textAlign: "center" }}>
              Previewing the first {MAX_PREVIEW_PAGES} pages. Download the file to see the rest.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
