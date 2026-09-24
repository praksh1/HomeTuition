import type { DocumentPickerAsset } from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
export async function readQuizDocument(file: DocumentPickerAsset): Promise<string> {
  if (file.name.toLowerCase().endsWith(".pdf")) throw new Error("For PDF conversion, open Fadko in your phone's browser. Here you can import a text file or paste the questions.");
  const info = await FileSystem.getInfoAsync(file.uri);
  if (!info.exists || info.size > 8 * 1024 * 1024) throw new Error("Choose a text file smaller than 8 MB.");
  const text = await FileSystem.readAsStringAsync(file.uri);
  if (text.length > 60_000) throw new Error("Choose a shorter document (up to 60,000 characters).");
  return text;
}
