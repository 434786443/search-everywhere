/**
 * Coloured file-type badges shown before a result title, in the spirit of
 * IntelliJ's file icons (`J` for Java, `GO` for Go) and VS Code's Seti theme.
 *
 * Colours are mid-saturation so they stay legible on both dark and light
 * themes. An unknown extension returns `undefined`: the row then renders
 * without a badge rather than with a meaningless placeholder.
 */
export interface FileBadge {
  /** One to three characters, drawn bold and centred. */
  text: string;
  /** CSS colour for the text. */
  color: string;
}

const BADGES: Record<string, FileBadge> = {
  java: { text: "J", color: "#E76F00" },
  class: { text: "J", color: "#E76F00" },
  jar: { text: "J", color: "#E76F00" },
  go: { text: "GO", color: "#00ADD8" },
  mod: { text: "GO", color: "#00ADD8" },
  ts: { text: "TS", color: "#3178C6" },
  tsx: { text: "TS", color: "#3178C6" },
  mts: { text: "TS", color: "#3178C6" },
  js: { text: "JS", color: "#E8C547" },
  jsx: { text: "JS", color: "#E8C547" },
  mjs: { text: "JS", color: "#E8C547" },
  cjs: { text: "JS", color: "#E8C547" },
  json: { text: "{}", color: "#E8C547" },
  jsonc: { text: "{}", color: "#E8C547" },
  xml: { text: "<>", color: "#E37933" },
  html: { text: "<>", color: "#E34F26" },
  htm: { text: "<>", color: "#E34F26" },
  css: { text: "#", color: "#42A5F5" },
  scss: { text: "#", color: "#CA5E8B" },
  sass: { text: "#", color: "#CA5E8B" },
  less: { text: "#", color: "#CA5E8B" },
  md: { text: "M", color: "#519ABA" },
  mdx: { text: "M", color: "#519ABA" },
  py: { text: "PY", color: "#3572A5" },
  rs: { text: "RS", color: "#DEA584" },
  kt: { text: "K", color: "#A97BFF" },
  kts: { text: "K", color: "#A97BFF" },
  gradle: { text: "G", color: "#00979D" },
  sh: { text: ">_", color: "#89E051" },
  bash: { text: ">_", color: "#89E051" },
  zsh: { text: ">_", color: "#89E051" },
  yml: { text: "Y", color: "#CB171E" },
  yaml: { text: "Y", color: "#CB171E" },
  toml: { text: "T", color: "#9C7A5B" },
  sql: { text: "SQL", color: "#E38C00" },
  vue: { text: "V", color: "#41B883" },
  php: { text: "PHP", color: "#777BB4" },
  rb: { text: "RB", color: "#CC342D" },
  c: { text: "C", color: "#6295CB" },
  h: { text: "H", color: "#6295CB" },
  cpp: { text: "C+", color: "#6295CB" },
  cc: { text: "C+", color: "#6295CB" },
  hpp: { text: "H+", color: "#6295CB" },
  cs: { text: "C#", color: "#A179DC" },
  swift: { text: "S", color: "#F05138" },
  properties: { text: "P", color: "#B0B0B0" },
  ini: { text: "P", color: "#B0B0B0" },
  conf: { text: "P", color: "#B0B0B0" },
  png: { text: "IMG", color: "#26A69A" },
  jpg: { text: "IMG", color: "#26A69A" },
  jpeg: { text: "IMG", color: "#26A69A" },
  gif: { text: "IMG", color: "#26A69A" },
  svg: { text: "IMG", color: "#26A69A" },
  webp: { text: "IMG", color: "#26A69A" },
  txt: { text: "T", color: "#B0B0B0" },
  lock: { text: "L", color: "#B0B0B0" },
};

/** Command results have no path, so they get a fixed glyph. */
export const COMMAND_BADGE: FileBadge = { text: ">", color: "#9E9E9E" };

/** Badge for a file extension such as `.java`, `.go`, or an empty string. */
export function fileBadge(extension: string): FileBadge | undefined {
  const key = extension.replace(/^\./, "").toLowerCase();
  return key ? BADGES[key] : undefined;
}
