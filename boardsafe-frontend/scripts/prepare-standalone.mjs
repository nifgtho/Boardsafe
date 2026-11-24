import { cp, mkdir } from "node:fs/promises";

const target = new URL("../.next/standalone/", import.meta.url);
await mkdir(new URL(".next/", target), { recursive: true });
await cp(new URL("../public/", import.meta.url), new URL("public/", target), { recursive: true });
await cp(new URL("../.next/static/", import.meta.url), new URL(".next/static/", target), { recursive: true });
