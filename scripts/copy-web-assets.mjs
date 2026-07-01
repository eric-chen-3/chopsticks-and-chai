import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDir = join(root, "www");

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

for (const entry of ["index.html", "styles.css", "game.js", "assets"]) {
  await cp(join(root, entry), join(outputDir, entry), { recursive: true });
}

console.log(`Copied web assets to ${outputDir}`);
