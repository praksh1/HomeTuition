import { Platform } from "react-native";
import type { UploadableFile } from "@/utils/uploadFile";

/** Keep a face photo sharp in a 40–88 px avatar without shipping a full camera original. */
export async function prepareProfilePhoto(file: UploadableFile): Promise<{
  file: UploadableFile;
  release: () => void;
}> {
  if (Platform.OS !== "web" || typeof createImageBitmap !== "function") {
    return { file, release: () => {} };
  }

  try {
    const original = await (await fetch(file.uri)).blob();
    if (original.size <= 200_000) return { file, release: () => {} };
    const image = await createImageBitmap(original);
    try {
      const scale = Math.min(1, 640 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return { file, release: () => {} };
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const small = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
      if (!small || small.size >= original.size) return { file, release: () => {} };
      const uri = URL.createObjectURL(small);
      return {
        file: { uri, name: "profile-photo.jpg", mimeType: "image/jpeg", size: small.size },
        release: () => URL.revokeObjectURL(uri),
      };
    } finally {
      image.close();
    }
  } catch {
    // HEIC support differs between browsers. Preserve the original instead of losing the photo.
    return { file, release: () => {} };
  }
}
