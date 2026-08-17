import { Platform } from "react-native";

/**
 * Longest edge, in pixels, that a board image is downscaled to. A phone camera photo is
 * 3000-4000px wide; the board is never more than ~1000px on screen even zoomed in, so
 * anything beyond this is pure memory cost with no visible benefit.
 */
const MAX_EDGE = 1600;

/**
 * Hard ceiling on the encoded image. The image is held in React state, re-encoded into a
 * JSON WebSocket frame, and decoded by every participant, so an uncapped multi-megabyte
 * upload is what exhausts memory and takes the video call down with it.
 */
const MAX_BYTES = 1_500_000;

/** Quality/size ladder, tried in order until the result fits under MAX_BYTES. */
const ATTEMPTS: { edge: number; quality: number }[] = [
  { edge: MAX_EDGE, quality: 0.72 },
  { edge: MAX_EDGE, quality: 0.55 },
  { edge: 1200, quality: 0.5 },
  { edge: 900, quality: 0.45 },
];

export class BoardImageError extends Error {}

const TOO_BIG_MESSAGE =
  "This photo is too large to share on the board. Please pick a smaller one, or take a screenshot of it first.";

/** Approximate decoded byte length of a base64 data URI without materialising a copy. */
function dataUrlBytes(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(",");
  const base64Length = commaIndex === -1 ? dataUrl.length : dataUrl.length - commaIndex - 1;
  return Math.floor((base64Length * 3) / 4);
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new BoardImageError("That file could not be opened as an image."));
    img.src = url;
  });
}

async function prepareWeb(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(objectUrl);
    const sourceW = img.naturalWidth;
    const sourceH = img.naturalHeight;
    if (!sourceW || !sourceH) throw new BoardImageError("That file could not be opened as an image.");

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new BoardImageError("Your browser could not process this image.");

    for (const { edge, quality } of ATTEMPTS) {
      const scale = Math.min(1, edge / Math.max(sourceW, sourceH));
      const w = Math.max(1, Math.round(sourceW * scale));
      const h = Math.max(1, Math.round(sourceH * scale));

      canvas.width = w;
      canvas.height = h;
      // JPEG has no alpha channel, so a transparent PNG would otherwise flatten to black
      // against the white board.
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (dataUrlBytes(dataUrl) <= MAX_BYTES) return dataUrl;
    }

    throw new BoardImageError(TOO_BIG_MESSAGE);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * There is no canvas on native, so the picker's own JPEG re-encode is the only compression
 * available. The base64 payload matters regardless of size: broadcasting the picker's
 * `file://` URI instead would leave every student with a permanently broken image, since
 * that path only exists on the teacher's device.
 */
function prepareNative(asset: { uri: string; base64?: string | null; mimeType?: string | null }): string {
  if (!asset.base64) {
    throw new BoardImageError("Could not read that photo. Please try another one.");
  }
  const mime = asset.mimeType && asset.mimeType.startsWith("image/") ? asset.mimeType : "image/jpeg";
  const dataUrl = `data:${mime};base64,${asset.base64}`;
  if (dataUrlBytes(dataUrl) > MAX_BYTES) throw new BoardImageError(TOO_BIG_MESSAGE);
  return dataUrl;
}

export type BoardImageInput =
  | { platform: "web"; file: File }
  | { platform: "native"; asset: { uri: string; base64?: string | null; mimeType?: string | null } };

/**
 * Turns a picked photo into a bounded data URI safe to hold in state and broadcast.
 * Throws BoardImageError with a message that can be shown directly to the teacher.
 */
export async function prepareBoardImage(input: BoardImageInput): Promise<string> {
  if (input.platform === "web" && Platform.OS === "web") return prepareWeb(input.file);
  if (input.platform === "native") return prepareNative(input.asset);
  throw new BoardImageError("Could not process this photo on this device.");
}

/** Quality passed to expo-image-picker. Low, because native has no downscale step. */
export const NATIVE_PICKER_QUALITY = 0.4;

export { MAX_BYTES as MAX_BOARD_IMAGE_BYTES };
