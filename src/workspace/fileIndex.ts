import { FILE_BATCH_LIMIT } from "../limits";
import { IndexedEntry } from "../search/wasmFileSearch";

export interface FolderRoot {
  name: string;
  fsPath: string;
}

/** Index key for a workspace file: bare relative path when there is one folder, `
 * folder name prefix otherwise. */
export function keyFor(folder: FolderRoot, relativePath: string, single: boolean): string {
  return single ? relativePath : `${folder.name}/${relativePath}`;
}

export function makeEntries(folders: FolderRoot[], filesByFolder: Map<string, string[]>): IndexedEntry[] {
  const single = folders.length <= 1;
  const entries: IndexedEntry[] = [];
  for (const folder of folders) {
    for (const relativePath of filesByFolder.get(folder.fsPath) ?? []) {
      const key = keyFor(folder, relativePath, single);
      entries.push({ key, rel: key, library: false });
    }
  }
  return entries;
}

/** More than the batch limit at once is cheaper to answer with a full rescan. */
export function shouldFullRebuild(pending: number): boolean {
  return pending > FILE_BATCH_LIMIT;
}
