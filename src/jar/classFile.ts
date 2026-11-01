export interface ClassMethod { access: number; name: string; descriptor: string; signature?: string; }
export interface ClassInfo { access: number; thisName: string; superName?: string; interfaces: string[]; methods: ClassMethod[]; hasRecord: boolean; }

export function parseClassFile(buf: Buffer): ClassInfo {
  let o = 0;
  const u1 = () => buf[o++];
  const u2 = () => { const v = buf.readUInt16BE(o); o += 2; return v; };
  const u4 = () => { const v = buf.readUInt32BE(o); o += 4; return v; };
  if (u4() !== 0xcafebabe) throw new Error("bad magic");
  u2(); u2();
  const cpCount = u2();
  const cp: ({ s?: string; a?: number } | null)[] = [null];
  for (let i = 1; i < cpCount; i++) {
    const tag = u1();
    if (tag === 1) {
      const len = u2();
      cp[i] = { s: buf.subarray(o, o + len).toString("utf8") };
      o += len;
    } else if (tag === 7 || tag === 8 || tag === 16 || tag === 19 || tag === 20) cp[i] = { a: u2() };
    else if (tag === 3 || tag === 4) { u4(); cp[i] = {}; }
    else if (tag === 5 || tag === 6) { u4(); u4(); cp[i] = {}; cp[++i] = null; }
    else if (tag === 9 || tag === 10 || tag === 11 || tag === 12 || tag === 17 || tag === 18) { cp[i] = { a: u2() }; u2(); }
    else if (tag === 15) { u1(); u2(); cp[i] = {}; }
    else throw new Error(`unknown tag ${tag}`);
  }
  const utf = (i: number) => cp[i]?.s ?? "";
  const className = (i: number) => utf(cp[i]?.a ?? 0);
  const access = u2();
  const thisName = className(u2());
  const superIndex = u2();
  const superName = superIndex === 0 ? undefined : className(superIndex);
  const interfaces: string[] = [];
  for (let i = 0, n = u2(); i < n; i++) interfaces.push(className(u2()));
  const members = (keep: boolean): ClassMethod[] => {
    const found: ClassMethod[] = [];
    for (let i = 0, n = u2(); i < n; i++) {
      const mAccess = u2();
      const name = utf(u2());
      const descriptor = utf(u2());
      let signature: string | undefined;
      for (let a = 0, ac = u2(); a < ac; a++) {
        const an = utf(u2());
        const len = u4();
        if (an === "Signature") signature = utf(u2());
        else o += len;
      }
      if (keep && (mAccess & 0x1000) === 0 && (mAccess & 0x0040) === 0 && name !== "<clinit>") found.push({ access: mAccess, name, descriptor, signature });
    }
    return found;
  };
  members(false);
  const methods = members(true);
  let hasRecord = false;
  for (let a = 0, n = u2(); a < n; a++) {
    const an = utf(u2());
    const len = u4();
    if (an === "Record") hasRecord = true;
    o += len;
  }
  return { access, thisName, superName, interfaces, methods, hasRecord };
}
