import { EventEmitter } from "events";
import path from "path";
import { listFiles } from "./walk.js";

export class Scanner extends EventEmitter {
  async scan(directory) {
    this.emit("scan-start", { directory });

    const listing = await listFiles(directory);
    const files = listing.files.map((file) => ({
      ...file,
      extension: path.extname(file.path).toLowerCase() || "(none)",
    }));

    const byExtension = new Map();
    let totalSize = 0;
    let last7 = 0;
    let last30 = 0;
    let older90 = 0;

    const now = Date.now();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      totalSize += file.size;

      const daysOld = (now - file.mtime.getTime()) / (1000 * 60 * 60 * 24);
      if (daysOld <= 7) last7 += 1;
      if (daysOld <= 30) last30 += 1;
      if (daysOld > 90) older90 += 1;

      const ext = file.extension;
      const current = byExtension.get(ext) || { count: 0, totalSize: 0 };

      current.count += 1;
      current.totalSize += file.size;
      byExtension.set(ext, current);

      this.emit("file-found", {
        path: file.path,
        size: file.size,
        index: i + 1,
        total: files.length,
      });
    }

    const largest = [...files].sort((a, b) => b.size - a.size).slice(0, 3);
    const oldest =
      files.length === 0
        ? null
        : [...files].sort((a, b) => a.mtime.getTime() - b.mtime.getTime())[0];

    const statistics = {
      totalFiles: files.length,
      totalSize,
      byExtension,
      age: { last7, last30, older90 },
      largest,
      oldest,
      now,
      skipped: listing.skipped,
    };

    this.emit("scan-complete", statistics);
    return statistics;
  }
}
