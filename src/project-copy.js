import { cp, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  ".safe-install",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
]);

const MAX_COPY_BYTES = 250 * 1024 * 1024;

export async function copyProjectForSandbox(source, destination) {
  await mkdir(destination, { recursive: true });
  const state = { copiedBytes: 0, skipped: [] };
  await copyEntry(source, destination, source, state);
  return state;
}

async function copyEntry(source, destination, root, state) {
  const info = await stat(source);
  const rel = relative(root, source);
  const name = rel.split(/[\\/]/).at(-1);

  if (info.isDirectory()) {
    if (name && EXCLUDED_DIRS.has(name)) {
      state.skipped.push(rel);
      return;
    }

    await mkdir(destination, { recursive: true });
    const entries = await readdir(source);
    for (const entry of entries) {
      await copyEntry(join(source, entry), join(destination, entry), root, state);
    }
    return;
  }

  if (!info.isFile()) return;

  state.copiedBytes += info.size;
  if (state.copiedBytes > MAX_COPY_BYTES) {
    throw new Error(`project copy exceeded ${MAX_COPY_BYTES} bytes; add large directories to safe-install exclusions`);
  }

  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { dereference: false, errorOnExist: false, force: true });
}
