import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.resolve("next/package.json"));
require("@next/env").loadEnvConfig(process.cwd(), false);
const server = new URL("../.next/standalone/server.js", import.meta.url);
if (!existsSync(server)) throw new Error("Ejecuta npm run build antes de npm start.");
process.env.HOSTNAME = process.env.BOARDSAFE_WEB_HOST ?? "127.0.0.1";
await import(server.href);
