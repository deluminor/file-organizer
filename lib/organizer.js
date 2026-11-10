import { EventEmitter } from "events";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { pipeline } from "stream/promises";
import { listFiles } from "./walk.js";

const TEN_MB = 10 * 1024 * 1024;

export const CATEGORIES = {
  Documents: [".pdf", ".docx", ".doc", ".txt", ".md", ".xlsx", ".pptx"],
  Images: [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp"],
  Archives: [".zip", ".rar", ".tar", ".gz", ".7z"],
  Code: [".js", ".py", ".java", ".cpp", ".html", ".css", ".json"],
  Videos: [".mp4", ".avi", ".mkv", ".mov", ".webm"],
  Other: [],
};

function getCategory(extension) {
  const ext = extension.toLowerCase();

  for (const [category, extensions] of Object.entries(CATEGORIES)) {
    if (extensions.includes(ext)) {
      return category;
    }
  }

  return "Other";
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

async function pathExists(filePath) {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function uniqueTargetPath(targetPath) {
  if (!(await pathExists(targetPath))) return targetPath;

  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const base = path.basename(targetPath, ext);
  let counter = 1;

  while (await pathExists(path.join(dir, `${base}(${counter})${ext}`))) {
    counter += 1;
  }

  return path.join(dir, `${base}(${counter})${ext}`);
}

async function copyFileBySize(sourcePath, targetPath, size) {
  if (size < TEN_MB) {
    await fsPromises.copyFile(sourcePath, targetPath);
    return;
  }

  await pipeline(
    fs.createReadStream(sourcePath),
    fs.createWriteStream(targetPath),
  );
}

export class Organizer extends EventEmitter {
  async organize(source, target) {
    const sourceAbs = path.resolve(source);
    const targetAbs = path.resolve(target);

    if (sourceAbs === targetAbs) {
      throw new Error(`Source and target must differ: ${sourceAbs}`);
    }

    const listing = await listFiles(sourceAbs, {
      exclude: isInside(targetAbs, sourceAbs) ? targetAbs : undefined,
    });

    const files = listing.files.map((file) => ({
      path: file.path,
      name: path.basename(file.path),
      size: file.size,
      extension: path.extname(file.path),
    }));

    const categoryNames = Object.keys(CATEGORIES);
    for (const category of categoryNames) {
      await fsPromises.mkdir(path.join(target, category), { recursive: true });
    }

    const summary = Object.fromEntries(categoryNames.map((name) => [name, 0]));
    let totalCopied = 0;
    let totalSize = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const category = getCategory(file.extension);
      const categoryDir = path.join(target, category);
      let destination = path.join(categoryDir, file.name);

      this.emit("copy-start", {
        path: file.path,
        category,
        index: i + 1,
        total: files.length,
      });

      try {
        destination = await uniqueTargetPath(destination);
        await copyFileBySize(file.path, destination, file.size);
        summary[category] += 1;
        totalCopied += 1;
        totalSize += file.size;

        this.emit("copy-complete", {
          path: file.path,
          destination,
          category,
          size: file.size,
          index: i + 1,
          total: files.length,
        });
      } catch (error) {
        this.emit("copy-error", {
          path: file.path,
          error,
          index: i + 1,
          total: files.length,
        });

        throw error;
      }
    }

    return {
      summary,
      totalCopied,
      totalSize,
      categories: categoryNames,
      target,
      skipped: listing.skipped,
    };
  }
}
