import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "obsidian-smoke-"));
mkdirSync(join(dir, "uploads"));
copyFileSync(join(process.cwd(), "build", "index.mjs"), join(dir, "index.mjs"));

const p = spawn(process.execPath, ["index.mjs"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
let out = "";
p.stdout.on("data", (d) => (out += d));
p.stderr.on("data", (d) => (out += d));

setTimeout(() => {
  p.kill();
  const ok = out.includes("Server listening");
  console.log(out.trim());
  process.exit(ok ? 0 : 1);
}, 6000);
