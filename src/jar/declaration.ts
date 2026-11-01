import { ClassInfo, ClassMethod } from "./classFile";

const BASE: Record<string, string> = { B: "byte", C: "char", D: "double", F: "float", I: "int", J: "long", S: "short", Z: "boolean" };

function parseType(sig: string, i: number): [string, number] {
  const c = sig[i];
  if (BASE[c]) return [BASE[c], i + 1];
  if (c === "T") { const end = sig.indexOf(";", i); return [sig.slice(i + 1, end), end + 1]; }
  if (c === "[") { const [inner, n] = parseType(sig, i + 1); return [`${inner}[]`, n]; }
  if (c !== "L") throw new Error("bad signature");
  let j = i + 1;
  let name = "";
  while (sig[j] !== "<" && sig[j] !== ";") { name += sig[j] === "/" ? "." : sig[j]; j++; }
  let args = "";
  if (sig[j] === "<") {
    j++;
    const parts: string[] = [];
    while (sig[j] !== ">") {
      if (sig[j] === "*") { parts.push("?"); j++; continue; }
      if (sig[j] === "+" || sig[j] === "-") {
        const [t, n] = parseType(sig, j + 1);
        parts.push(`? ${sig[j] === "+" ? "extends" : "super"} ${t}`);
        j = n;
        continue;
      }
      const [t, n] = parseType(sig, j);
      parts.push(t);
      j = n;
    }
    args = `<${parts.join(", ")}>`;
    j++;
  }
  if (sig[j] !== ";") throw new Error("bad signature");
  return [name + args, j + 1];
}

function parseMethodType(sig: string): { params: string[]; ret: string } {
  let i = 0;
  if (sig[0] === "<") {
    let depth = 0;
    for (; i < sig.length; i++) {
      if (sig[i] === "<") depth++;
      else if (sig[i] === ">") { depth--; if (depth === 0) { i++; break; } }
    }
  }
  i++;
  const params: string[] = [];
  while (sig[i] !== ")") { const [t, n] = parseType(sig, i); params.push(t); i = n; }
  i++;
  if (sig[i] === "V") return { params, ret: "void" };
  const [ret] = parseType(sig, i);
  return { params, ret };
}

function methodLine(method: ClassMethod, simple: string): string {
  const types = method.signature ? tryParse(method.signature) ?? parseMethodType(method.descriptor) : parseMethodType(method.descriptor);
  const flags = method.access;
  const mods = [flags & 0x0001 ? "public" : "", flags & 0x0004 ? "protected" : "", flags & 0x0002 ? "private" : "", flags & 0x0008 ? "static" : "", flags & 0x0010 ? "final" : "", flags & 0x0400 ? "abstract" : ""].filter(Boolean);
  const prefix = mods.length ? `${mods.join(" ")} ` : "";
  if (method.name === "<init>") return `    ${prefix}${simple}(${types.params.join(", ")});`;
  return `    ${prefix}${types.ret} ${method.name}(${types.params.join(", ")});`;
}

function tryParse(sig: string): { params: string[]; ret: string } | undefined {
  try { return parseMethodType(sig); } catch { return undefined; }
}

export function formatDeclaration(info: ClassInfo): string {
  const chunks = info.thisName.split("/");
  const rawSimple = chunks.pop() ?? info.thisName;
  const simple = rawSimple.split("$").pop() ?? rawSimple;
  const pkg = chunks.join(".");
  const dotted = (name: string) => name.replaceAll("/", ".");
  let kind = "class";
  if (info.access & 0x2000) kind = "@interface";
  else if (info.access & 0x0200) kind = "interface";
  else if (info.access & 0x4000) kind = "enum";
  else if (info.hasRecord) kind = "record";
  const visibility = info.access & 0x0001 ? "public " : "";
  const superName = info.superName ? dotted(info.superName) : undefined;
  const omitSuper = !superName || superName === "java.lang.Object" || superName === "java.lang.Enum";
  const iface = info.interfaces.map(dotted);
  const isIface = kind === "interface" || kind === "@interface";
  let header = `${visibility}${kind} ${simple}`;
  if (!isIface && !omitSuper) header += ` extends ${superName}`;
  if (isIface && iface.length) header += ` extends ${iface.join(", ")}`;
  if (!isIface && iface.length) header += ` implements ${iface.join(", ")}`;
  const lines = pkg ? [`package ${pkg};`, "", header] : [header];
  for (const method of info.methods) lines.push(methodLine(method, simple));
  return lines.join("\n");
}
