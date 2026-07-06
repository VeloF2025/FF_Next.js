/** Read a File/Blob as raw base64 (strips the data:...;base64, prefix). Takes
 *  a `Blob` (File extends Blob) so it also serves as the Blob-at-rest →
 *  base64-on-the-wire conversion for durable IndexedDB-stored photos. */
export function readFileAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] ?? result;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
