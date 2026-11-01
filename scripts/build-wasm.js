// Rebuilds vendor/wasm from a local OpenIdea checkout.
// Usage: npm run build:wasm [-- /path/to/openidea]
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const openidea = process.argv[2] ?? path.join(__dirname, "..", "..", "openidea");
const out = path.join(__dirname, "..", "vendor", "wasm");
fs.mkdirSync(out, { recursive: true });
execFileSync(path.join(openidea, "scripts", "build-file-search-wasm.sh"), [out], { stdio: "inherit" });
for (const name of fs.readdirSync(out)) {
  if (name.endsWith(".d.ts") || name === "package.json" || name === ".gitignore") {
    fs.rmSync(path.join(out, name), { recursive: true, force: true });
  }
}
console.log(`vendor/wasm: ${fs.readdirSync(out).join(", ")}`);
