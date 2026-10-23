import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/** Stores files on the local disk (development only — hosted disks are often wiped on deploy). */
export function createLocalDriver({ localDir }) {
  const root = path.resolve(localDir);
  const resolve = (key) => {
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage key");
    return full;
  };

  return {
    name: "local",
    async put(key, buffer) {
      const full = resolve(key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, buffer);
    },
    async get(key) {
      const full = resolve(key);
      await stat(full); // throws ENOENT when missing
      return createReadStream(full);
    },
    async remove(key) {
      await rm(resolve(key), { force: true });
    },
  };
}
