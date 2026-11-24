import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const worker = import.meta.resolve("maplibre-gl/dist/maplibre-gl-worker.mjs");
const publicDir = new URL("../public/", import.meta.url);
await mkdir(publicDir, { recursive: true });
await copyFile(fileURLToPath(worker), new URL("maplibre-gl-worker.mjs", publicDir));
