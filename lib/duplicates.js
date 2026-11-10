import crypto from "crypto";
import { EventEmitter } from "events";
import fs from "fs";
import { listFiles } from "./walk.js";

function calculateHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export class DuplicateFinder extends EventEmitter {
  async find(directory) {
    const { files, skipped } = await listFiles(directory);

    const hashMap = new Map();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const hash = await calculateHash(file.path);
      const group = hashMap.get(hash) || [];
      group.push(file);
      hashMap.set(hash, group);

      this.emit("file-processed", {
        path: file.path,
        hash,
        index: i + 1,
        total: files.length,
      });
    }

    const groups = [];
    let totalWasted = 0;

    for (const [hash, groupFiles] of hashMap.entries()) {
      if (groupFiles.length <= 1) continue;

      const size = groupFiles[0].size;
      const wasted = size * (groupFiles.length - 1);
      totalWasted += wasted;

      groups.push({
        hash,
        copies: groupFiles.length,
        size,
        wasted,
        paths: groupFiles.map((f) => f.path),
      });
    }

    const result = { groups, totalWasted, totalFiles: files.length, skipped };
    this.emit("duplicates-found", result);

    return result;
  }
}
