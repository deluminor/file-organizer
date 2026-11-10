import { EventEmitter } from "events";
import fs from "fs/promises";
import path from "path";
import { listFiles } from "./walk.js";

export class Cleanup extends EventEmitter {
  async cleanup(directory, days, confirm = false) {
    const { files, skipped } = await listFiles(directory);
    const candidates = [];
    const now = Date.now();

    for (const entry of files) {
      const daysOld = (now - entry.mtime.getTime()) / (1000 * 60 * 60 * 24);
      if (daysOld > days) {
        const file = {
          path: entry.path,
          name: path.basename(entry.path),
          size: entry.size,
          mtime: entry.mtime,
          daysOld: Math.floor(daysOld),
        };
        candidates.push(file);
        this.emit("file-found", file);
      }
    }

    let deletedCount = 0;
    let freedSize = 0;
    const failed = [];

    if (confirm) {
      for (let i = 0; i < candidates.length; i++) {
        const file = candidates[i];

        try {
          await fs.unlink(file.path);
        } catch (error) {
          failed.push({ path: file.path, code: error.code ?? "UNKNOWN" });
          this.emit("file-error", { path: file.path, error });
          continue;
        }

        deletedCount += 1;
        freedSize += file.size;

        this.emit("file-deleted", {
          ...file,
          index: i + 1,
          total: candidates.length,
        });
      }
    }

    const result = {
      directory,
      days,
      confirm,
      files: candidates,
      deletedCount,
      freedSize,
      failed,
      skipped,
      totalSize: candidates.reduce((sum, file) => sum + file.size, 0),
    };

    this.emit("cleanup-complete", result);
    return result;
  }
}
