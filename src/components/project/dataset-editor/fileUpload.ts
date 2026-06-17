import type { ImportFilePayload } from "../../../lib/desktopApi";

/** Reads a browser `File` into a base64 string (without the data-URL prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unexpected file reader result"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/** Converts a `File` into the `{ name, dataBase64 }` payload the backend expects. */
export async function fileToImportPayload(file: File): Promise<ImportFilePayload> {
  return { name: file.name, dataBase64: await fileToBase64(file) };
}
