import JSZip from "jszip";
import type { Entry } from "./skill-formats";

export type SaveResult =
  | { kind: "saved"; rootName: string; paths: string[] }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

// Feature detection — used by the UI to hide the "Save to folder…" button on
// Firefox/Safari/mobile.
export function canSaveToFolder(): boolean {
  return typeof (window as any).showDirectoryPicker === "function";
}

// Walk a slash-separated path and ensure every intermediate directory exists,
// returning the final FileSystemDirectoryHandle.
async function ensureDir(
  root: any,
  parts: string[],
): Promise<any> {
  let dir = root;
  for (const part of parts) {
    if (!part) continue;
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return dir;
}

async function writeOneEntry(root: any, entry: Entry): Promise<void> {
  const segments = entry.path.split("/");
  const filename = segments.pop()!;
  const dir = await ensureDir(root, segments);
  const fileHandle = await dir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(entry.content);
  await writable.close();
}

export async function saveToDirectory(entries: Entry[]): Promise<SaveResult> {
  if (!canSaveToFolder()) {
    return { kind: "error", message: "browser doesn't support direct save" };
  }
  let handle: any;
  try {
    handle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
  } catch (e: any) {
    // User cancelled the picker — not an error condition.
    if (e?.name === "AbortError") return { kind: "cancelled" };
    return { kind: "error", message: e?.message || "couldn't open picker" };
  }
  try {
    for (const entry of entries) {
      await writeOneEntry(handle, entry);
    }
    return {
      kind: "saved",
      rootName: handle.name,
      paths: entries.map(e => e.path),
    };
  } catch (e: any) {
    return { kind: "error", message: e?.message || "couldn't write files" };
  }
}

export async function saveAsZip(entries: Entry[], zipName: string): Promise<void> {
  const zip = new JSZip();
  for (const entry of entries) {
    zip.file(entry.path, entry.content);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
