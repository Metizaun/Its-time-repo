import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

let loaded = false;

export function loadEnv() {
  if (loaded) {
    return;
  }

  const currentFilePath = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFilePath);

  const candidates = [
    path.resolve(currentDir, ".env.local"),
    path.resolve(currentDir, ".env"),
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(currentDir, "..", ".env.local"),
    path.resolve(currentDir, "..", ".env"),
    path.resolve(currentDir, "..", "..", ".env.local"),
    path.resolve(currentDir, "..", "..", ".env"),
    path.resolve(process.cwd(), "..", ".env.local"),
    path.resolve(process.cwd(), "..", ".env"),
    path.resolve(process.cwd(), "..", "..", ".env.local"),
    path.resolve(process.cwd(), "..", "..", ".env"),
  ];

  for (const filePath of Array.from(new Set(candidates))) {
    if (fs.existsSync(filePath)) {
      dotenv.config({ path: filePath, override: false });
    }
  }

  loaded = true;
}

loadEnv();
