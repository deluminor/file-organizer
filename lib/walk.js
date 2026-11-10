import fs from "fs/promises";
import path from "path";

async function statFile(fullPath, root, files, skipped) {
  try {
    const stats = await fs.stat(fullPath);
    if (!stats.isFile()) return;

    files.push({
      path: fullPath,
      relativePath: path.relative(root, fullPath),
      size: stats.size,
      mtime: stats.mtime,
    });
  } catch (error) {
    skipped.push({ path: fullPath, code: error.code ?? "UNKNOWN" });
  }
}

async function walk(dir, root, exclude, files, skipped) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (dir === root) throw error;
    skipped.push({ path: dir, code: error.code ?? "UNKNOWN" });

    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (exclude && fullPath === exclude) continue;

    if (entry.isDirectory()) {
      await walk(fullPath, root, exclude, files, skipped);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      await statFile(fullPath, root, files, skipped);
    }
  }
}

export async function listFiles(root, { exclude } = {}) {
  const files = [];
  const skipped = [];
  const excludePath = exclude ? path.resolve(exclude) : undefined;

  await walk(
    path.resolve(root),
    path.resolve(root),
    excludePath,
    files,
    skipped,
  );

  return { files, skipped };
}
