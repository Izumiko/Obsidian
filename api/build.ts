import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(rootDir, "build");

const copyIfExists = (from: string, to: string): void => {
  if (!fs.existsSync(from)) return;
  fs.cpSync(from, to, { recursive: true });
};

const cjsBanner = `
import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __dirnamePath } from "node:path";

const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirnamePath(__filename);
  `.trim();

async function build(): Promise<void> {
  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(rootDir, "src/index.ts")],
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    outfile: path.join(buildDir, "index.mjs"),
    minify: true,
    sourcemap: true,
    logLevel: "info",

    banner: {
      js: cjsBanner,
    },
  });

    await esbuild.build({
    entryPoints: [path.join(rootDir, "src/seed.ts")],
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    outfile: path.join(buildDir, "seed.mjs"),
    minify: true,
    sourcemap: true,
    logLevel: "info",

    banner: {
      js: cjsBanner,
    },
  });

  copyIfExists(path.join(rootDir, "uploads"), path.join(buildDir, "uploads"));
  copyIfExists(path.join(rootDir, "prisma/migrations"), path.join(buildDir, "prisma/migrations"));
  copyIfExists(path.join(rootDir, "prisma/schema.prisma"), path.join(buildDir, "prisma/schema.prisma"));
}

build().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});