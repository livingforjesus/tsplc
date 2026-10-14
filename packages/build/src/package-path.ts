import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Both source modules and published bundles live one directory below the package root.
export const packageDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)));
