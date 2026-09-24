import type { DocumentPickerAsset } from "expo-document-picker";

/** Reads only the file selected by the user, locally. No upload or third-party AI request. */
export async function readQuizDocument(file: DocumentPickerAsset): Promise<string> {
  if (!file.uri.startsWith("blob:") && !file.uri.startsWith("data:")) throw new Error("Choose a local PDF or text document.");
  if (file.size && file.size > 8 * 1024 * 1024) throw new Error("Choose a file smaller than 8 MB.");
  const blob = await (await fetch(file.uri)).blob();
  if (blob.size > 8 * 1024 * 1024) throw new Error("Choose a file smaller than 8 MB.");
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    const text = await blob.text();
    if (text.length > 60_000) throw new Error("Choose a shorter document (up to 60,000 characters).");
    return text;
  }
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = `${location.origin}/pdf.worker.min.js`;
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false, disableAutoFetch: true, disableFontFace: true });
  const timer = setTimeout(() => void task.destroy().catch(() => {}), 20_000);
  try {
    const doc = await task.promise;
    if (doc.numPages > 25) throw new Error("Choose a PDF with 25 pages or fewer.");
    let text = "";
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo);
      const content = await page.getTextContent();
      let lastY: number | null = null;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const y = item.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 2) text += "\n";
        text += item.str + (item.hasEOL ? "\n" : " ");
        lastY = item.hasEOL ? null : y;
        if (text.length > 60_000) throw new Error("This PDF contains too much text. Split it into a smaller quiz.");
      }
      text += "\n";
      page.cleanup();
    }
    if (!text.trim()) throw new Error("This PDF has no selectable text. Paste the questions or use a text-based PDF; scanned pages are not read automatically.");
    return text;
  } finally { clearTimeout(timer); await task.destroy(); }
}
