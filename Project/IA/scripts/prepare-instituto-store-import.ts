import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseInstitutoStores } from "../store-locator-import.js";

const sourcePath = resolve(process.cwd(), "../../referencias/IA Instituto/Lojas Instituto.md");
const markdown = await readFile(sourcePath, "utf8");
const result = parseInstitutoStores(markdown);

console.log(JSON.stringify({
  source: sourcePath,
  storeCount: result.stores.length,
  readyCount: result.stores.length - new Set(result.issues.map((issue) => issue.storeName)).size,
  issues: result.issues,
  stores: result.stores,
}, null, 2));
