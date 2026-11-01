export function classEntryToSourceEntry(classEntry: string): string {
  const withoutExt = classEntry.replace(/\.class$/, "");
  return `${withoutExt.split("$")[0]}.java`;
}

export function classNameFromEntry(classEntry: string): { simpleName: string; binaryName: string } {
  const binaryName = classEntry.replace(/\.class$/, "").replaceAll("/", ".");
  const tail = binaryName.split("$").pop() ?? binaryName;
  const simpleName = tail.split(".").pop() ?? tail;
  return { simpleName, binaryName };
}

export function findDeclarationLine(source: string, simpleName: string): number | undefined {
  const escaped = simpleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:@interface|class|interface|enum|record)\\s+${escaped}\\b`);
  const lines = source.split(/\r?\n/);
  const index = lines.findIndex(line => pattern.test(line));
  return index < 0 ? undefined : index + 1;
}
