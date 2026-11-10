#!/usr/bin/env node
import path from "path";
import { Cleanup } from "./lib/cleanup.js";
import { DuplicateFinder } from "./lib/duplicates.js";
import { CATEGORIES, Organizer } from "./lib/organizer.js";
import { Scanner } from "./lib/scanner.js";

export function formatSize(bytes) {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function drawProgressBar(current, total, width = 20) {
  if (total <= 0) return `${"░".repeat(width)} 0/0`;

  const percentage = current / total;
  const filled = Math.round(percentage * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);

  return `${bar} ${current}/${total}`;
}

const SKIPPED_PREVIEW_LIMIT = 5;

function handleError(error, target) {
  const failedPath = error.path ?? target;

  if (error.code === "ENOENT") {
    console.error(`❌ Error: Directory not found: ${failedPath}`);
  } else if (error.code === "EACCES") {
    console.error(`❌ Error: Permission denied: ${failedPath}`);
  } else {
    console.error(`❌ Unexpected error: ${error.message}`);
  }

  process.exit(1);
}

function printSkipped(skipped) {
  if (!skipped || skipped.length === 0) return;

  console.log("");
  console.log(`⚠ Skipped ${skipped.length} unreadable entries`);

  for (const entry of skipped.slice(0, SKIPPED_PREVIEW_LIMIT)) {
    console.log(`  ${entry.path} (${entry.code})`);
  }

  if (skipped.length > SKIPPED_PREVIEW_LIMIT) {
    console.log(`  ... (${skipped.length - SKIPPED_PREVIEW_LIMIT} more)`);
  }
}

function printUsage() {
  console.log(`Usage:
  node file-organizer.js scan <directory>
  node file-organizer.js duplicates <directory>
  node file-organizer.js organize <source> --output <target>
  node file-organizer.js cleanup <directory> --older-than <days> [--confirm]`);
}

function resolvePath(inputPath) {
  return path.resolve(inputPath);
}

function truncateHash(hash) {
  return `${hash.slice(0, 12)}...`;
}

async function runScan(directory) {
  const scanner = new Scanner();
  let lastTotal = 0;

  scanner.on("scan-start", (data) => {
    console.log(`📂  Scanning: ${data.directory}`);
  });

  scanner.on("file-found", (data) => {
    lastTotal = data.total;
    process.stdout.write(
      `\rProcessing... ${drawProgressBar(data.index, data.total)} files`,
    );
  });

  try {
    const stats = await scanner.scan(directory);
    if (lastTotal > 0) {
      process.stdout.write("\n");
    } else {
      console.log(`Processing... ${drawProgressBar(0, 0)} files`);
    }

    console.log("");
    console.log("📊  Scan Results:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`Total files: ${stats.totalFiles}`);
    console.log(`Total size: ${formatSize(stats.totalSize)}`);
    console.log("");
    console.log("By File Type:");

    const sortedExt = [...stats.byExtension.entries()].sort(
      (a, b) => b[1].totalSize - a[1].totalSize,
    );
    for (const [ext, info] of sortedExt) {
      const label = ext.padEnd(8);
      const count = `${info.count} files`.padEnd(10);
      console.log(`  ${label}${count}${formatSize(info.totalSize)}`);
    }

    console.log("");
    console.log("File Age:");
    console.log(`  Last 7 days:    ${stats.age.last7} files`);
    console.log(`  Last 30 days:   ${stats.age.last30} files`);
    console.log(`  Older than 90:  ${stats.age.older90} files`);
    console.log("");
    console.log("Largest files:");

    if (stats.largest.length === 0) {
      console.log("  (none)");
    } else {
      stats.largest.forEach((file, index) => {
        console.log(
          `  ${index + 1}. ${path.basename(file.path).padEnd(24)} ${formatSize(file.size)}`,
        );
      });
    }

    console.log("");
    if (stats.oldest) {
      const daysAgo = Math.floor(
        (stats.now - stats.oldest.mtime.getTime()) / (1000 * 60 * 60 * 24),
      );
      console.log(
        `Oldest file: ${path.basename(stats.oldest.path)} (modified ${daysAgo} days ago)`,
      );
    } else {
      console.log("Oldest file: (none)");
    }
    printSkipped(stats.skipped);
  } catch (error) {
    handleError(error, directory);
  }
}

async function runDuplicates(directory) {
  const finder = new DuplicateFinder();

  console.log(`🔍  Searching for duplicates in: ${directory}`);

  finder.on("file-processed", (data) => {
    process.stdout.write(
      `\rCalculating hashes... ${drawProgressBar(data.index, data.total)} files`,
    );
  });

  try {
    const result = await finder.find(directory);
    if (result.totalFiles > 0) {
      process.stdout.write("\n");
    } else {
      console.log(`Calculating hashes... ${drawProgressBar(0, 0)} files`);
    }

    console.log("");
    console.log(
      `Found ${result.groups.length} duplicate groups (${formatSize(result.totalWasted)} wasted):`,
    );

    if (result.groups.length === 0) {
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("No duplicates found.");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`💾  Total wasted space: ${formatSize(0)}`);
      printSkipped(result.skipped);
      return;
    }

    result.groups.forEach((group, index) => {
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(
        `Group ${index + 1} (${group.copies} copies, ${formatSize(group.size)} each):`,
      );
      console.log(`  SHA-256: ${truncateHash(group.hash)}`);
      for (const filePath of group.paths) {
        console.log(`    📄  ${filePath}`);
      }
      console.log(`    Wasted space: ${formatSize(group.wasted)}`);
    });

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`💾  Total wasted space: ${formatSize(result.totalWasted)}`);
    printSkipped(result.skipped);
  } catch (error) {
    handleError(error, directory);
  }
}

async function runOrganize(source, target) {
  const organizer = new Organizer();

  console.log(`📦  Organizing: ${source}`);
  console.log(`Target: ${target}`);
  console.log("");
  console.log("Creating folders...");
  for (const category of Object.keys(CATEGORIES)) {
    console.log(`  ✓  ${category}/`);
  }
  console.log("");
  process.stdout.write("Copying files...");

  organizer.on("copy-complete", (data) => {
    process.stdout.write(
      `\rCopying files... ${drawProgressBar(data.index, data.total)}`,
    );
  });

  organizer.on("copy-error", (data) => {
    process.stdout.write("\n");
    console.error(`❌ Failed to copy: ${data.path}`);
  });

  try {
    const result = await organizer.organize(source, target);
    if (result.totalCopied > 0) {
      process.stdout.write("\n");
    } else {
      process.stdout.write(` ${drawProgressBar(0, 0)}\n`);
    }

    console.log("");
    console.log("✅  Organization complete!");
    console.log("");
    console.log("Summary:");
    for (const category of result.categories) {
      const count = result.summary[category];
      console.log(
        `  ${`${category}:`.padEnd(11)} ${String(count).padStart(3)} files → ${path.join(path.basename(target), category)}/`,
      );
    }
    console.log("");
    console.log(
      `Total copied: ${result.totalCopied} files (${formatSize(result.totalSize)})`,
    );
    printSkipped(result.skipped);
  } catch (error) {
    handleError(error, source);
  }
}

async function runCleanup(directory, days, confirm) {
  const cleanup = new Cleanup();

  console.log(`🧹  Cleanup: ${directory}`);
  console.log(`Looking for files older than ${days} days...`);
  console.log("");

  try {
    const result = await cleanup.cleanup(directory, days, false);

    console.log(`Found ${result.files.length} files to delete:`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    if (result.files.length === 0) {
      console.log("(none)");
    } else {
      const preview = result.files.slice(0, 3);
      for (const file of preview) {
        const date = file.mtime.toISOString().slice(0, 10);
        console.log(file.name);
        console.log(
          `  Size: ${formatSize(file.size)}  Modified: ${file.daysOld} days ago (${date})`,
        );
        console.log("");
      }
      if (result.files.length > 3) {
        console.log(`... (${result.files.length - 3} more files)`);
      }
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(
      `Total: ${result.files.length} files (${formatSize(result.totalSize)})`,
    );
    console.log("");

    if (!confirm) {
      console.log("⚠   DRY RUN MODE: No files were deleted.");
      console.log("To actually delete these files, run with --confirm flag.");
      printSkipped(result.skipped);
      return;
    }

    console.log(
      `⚠   DELETING ${result.files.length} files (${formatSize(result.totalSize)}). This action cannot be undone!`,
    );
    console.log("");

    const deleter = new Cleanup();
    deleter.on("file-deleted", (data) => {
      process.stdout.write(
        `\rDeleting... ${drawProgressBar(data.index, data.total)}`,
      );
    });
    deleter.on("file-error", (data) => {
      process.stdout.write("\n");
      console.error(`❌ Failed to delete: ${data.path}`);
    });

    const deleted = await deleter.cleanup(directory, days, true);
    if (deleted.deletedCount > 0) {
      process.stdout.write("\n");
    } else {
      console.log(`Deleting... ${drawProgressBar(0, 0)}`);
    }

    console.log("");
    console.log("✅  Cleanup complete!");
    console.log(
      `Deleted: ${deleted.deletedCount} files (${formatSize(deleted.freedSize)} freed)`,
    );
    printSkipped(deleted.skipped);
    if (deleted.failed.length > 0) {
      console.error(`❌ Failed to delete ${deleted.failed.length} files`);
      process.exit(1);
    }
  } catch (error) {
    handleError(error, directory);
  }
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0];

  if (!command) {
    return { command: null };
  }

  if (command === "scan" || command === "duplicates") {
    const directory = args[1];
    return { command, directory };
  }

  if (command === "organize") {
    const source = args[1];
    const outputIndex = args.indexOf("--output");
    const target = outputIndex !== -1 ? args[outputIndex + 1] : undefined;
    return { command, source, target };
  }

  if (command === "cleanup") {
    const directory = args[1];
    const olderIndex = args.indexOf("--older-than");
    const daysRaw = olderIndex !== -1 ? args[olderIndex + 1] : undefined;
    const confirm = args.includes("--confirm");
    return {
      command,
      directory,
      days: daysRaw === undefined ? undefined : Number(daysRaw),
      confirm,
    };
  }

  return { command: "unknown", value: command };
}

async function main() {
  const parsed = parseArgs(process.argv);

  if (!parsed.command) {
    printUsage();
    process.exit(1);
  }

  if (parsed.command === "unknown") {
    console.error(`❌ Unknown command: ${parsed.value}`);
    printUsage();
    process.exit(1);
  }

  if (parsed.command === "scan") {
    if (!parsed.directory) {
      console.error("❌ Error: scan requires <directory>");
      printUsage();
      process.exit(1);
    }
    await runScan(resolvePath(parsed.directory));
    return;
  }

  if (parsed.command === "duplicates") {
    if (!parsed.directory) {
      console.error("❌ Error: duplicates requires <directory>");
      printUsage();
      process.exit(1);
    }
    await runDuplicates(resolvePath(parsed.directory));
    return;
  }

  if (parsed.command === "organize") {
    if (!parsed.source || !parsed.target) {
      console.error("❌ Error: organize requires <source> --output <target>");
      printUsage();
      process.exit(1);
    }
    await runOrganize(resolvePath(parsed.source), resolvePath(parsed.target));
    return;
  }

  if (parsed.command === "cleanup") {
    if (!parsed.directory || !Number.isFinite(parsed.days) || parsed.days < 0) {
      console.error(
        "❌ Error: cleanup requires <directory> --older-than <days>",
      );
      printUsage();
      process.exit(1);
    }
    await runCleanup(
      resolvePath(parsed.directory),
      parsed.days,
      parsed.confirm,
    );
  }
}

main();
