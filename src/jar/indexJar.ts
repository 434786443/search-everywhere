import { parseClassFile } from "./classFile";
import { formatDeclaration } from "./declaration";
import { classNameFromEntry } from "./sourcePath";

export interface JarIdentity { jarPath: string; mtimeMs: number; size: number; }
export interface SourcesIdentity { jarPath: string; mtimeMs: number; size: number; }
export interface ClassRecord { entry: string; simpleName: string; binaryName: string; declaration: string; signaturesFailed: boolean; annotation?: boolean; }
export interface TextRecord { entry: string; text: string; truncated: boolean; }
export interface PathRecord { entry: string; truncated: boolean; }
export interface IndexedJar extends JarIdentity {
  classes: ClassRecord[];
  texts: TextRecord[];
  paths: PathRecord[];
  sources?: SourcesIdentity;
  unreadableSources?: number;
  moduleRoots?: string[];
}
export interface IndexJarInput { jarPath: string; mtimeMs: number; size: number; entries: { name: string; data: Buffer }[]; fileTextCap: number; jarTextCap: number; }

export function sameJarIdentity(left: JarIdentity, right: JarIdentity): boolean {
  return left.jarPath === right.jarPath && left.mtimeMs === right.mtimeMs && left.size === right.size;
}

export function sameSourcesIdentity(left: SourcesIdentity | undefined, right: SourcesIdentity | undefined): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.jarPath === right.jarPath && left.mtimeMs === right.mtimeMs && left.size === right.size;
}

export function indexJarEntries(input: IndexJarInput): IndexedJar {
  const classes: ClassRecord[] = [];
  const texts: TextRecord[] = [];
  const paths: PathRecord[] = [];
  let used = 0;
  for (const entry of input.entries) {
    if (entry.name.endsWith("/")) continue;
    if (entry.name.endsWith(".class")) {
      try {
        const info = parseClassFile(entry.data);
        const name = classNameFromEntry(entry.name);
        classes.push({ entry: entry.name, ...name, declaration: formatDeclaration(info), signaturesFailed: false, annotation: (info.access & 0x2000) !== 0 });
      } catch {
        const name = classNameFromEntry(entry.name);
        const pkg = name.binaryName.includes(".") ? name.binaryName.slice(0, name.binaryName.lastIndexOf(".")) : "";
        classes.push({ entry: entry.name, ...name, declaration: `${pkg ? `package ${pkg};\n\n` : ""}${name.simpleName}\n无法读取方法签名`, signaturesFailed: true });
      }
      paths.push({ entry: entry.name, truncated: false });
      continue;
    }
    const binary = entry.data.includes(0);
    if (binary) { paths.push({ entry: entry.name, truncated: false }); continue; }
    if (used >= input.jarTextCap) {
      paths.push({ entry: entry.name, truncated: true });
      continue;
    }
    const room = Math.min(input.fileTextCap, input.jarTextCap - used);
    if (room <= 0) {
      paths.push({ entry: entry.name, truncated: true });
      continue;
    }
    const stored = entry.data.subarray(0, room);
    const text = stored.toString("utf8");
    const truncated = stored.length < entry.data.length;
    texts.push({ entry: entry.name, text, truncated });
    paths.push({ entry: entry.name, truncated });
    used += stored.length;
  }
  return { jarPath: input.jarPath, mtimeMs: input.mtimeMs, size: input.size, classes, texts, paths, unreadableSources: 0 };
}
