# file-organizer

CLI tool for analyzing, deduplicating, organizing, and cleaning up files in a directory. Built with Node.js ES Modules, EventEmitter progress events, and streams for large files.

## Requirements

- Node.js 18.17+ / 20.1+
- No npm dependencies (Node builtins only)

## Install

```bash
cd file-organizer
# no dependencies to install — Node builtins only
```

Optional npm scripts:

```bash
npm run scan -- /path/to/directory
npm run duplicates -- /path/to/directory
npm run organize -- /path/to/source --output /path/to/target
npm run cleanup -- /path/to/directory --older-than 90
```

## Project structure

```
file-organizer/
├── package.json
├── .gitignore
├── README.md
├── file-organizer.js
└── lib/
    ├── scanner.js
    ├── duplicates.js
    ├── organizer.js
    ├── cleanup.js
    └── walk.js
```

## Commands

### scan

Recursively scan a directory and print statistics: total count/size, by extension, age buckets, top-3 largest files, and the oldest file.

```bash
node file-organizer.js scan /path/to/directory
```

**Args**

- `<directory>` — path to scan recursively

**Events (`Scanner`)**

- `scan-start`
- `file-found`
- `scan-complete`

### duplicates

Find files with identical content using SHA-256 hashes computed via `fs.createReadStream` (never `readFile`).

```bash
node file-organizer.js duplicates /path/to/directory
```

**Args**

- `<directory>` — path to search for duplicate content

**Events (`DuplicateFinder`)**

- `file-processed`
- `duplicates-found`

Wasted space for a group = `fileSize * (copies - 1)`.

### organize

Copy (not move) files from a source directory into category folders under `--output`.

Categories and extensions:

| Category  | Extensions                                         |
| --------- | -------------------------------------------------- |
| Documents | `.pdf` `.docx` `.doc` `.txt` `.md` `.xlsx` `.pptx` |
| Images    | `.png` `.jpg` `.jpeg` `.gif` `.svg` `.webp` `.bmp` |
| Archives  | `.zip` `.rar` `.tar` `.gz` `.7z`                   |
| Code      | `.js` `.py` `.java` `.cpp` `.html` `.css` `.json`  |
| Videos    | `.mp4` `.avi` `.mkv` `.mov` `.webm`                |
| Other     | everything else                                    |

```bash
node file-organizer.js organize /path/to/source --output /path/to/target
```

**Args**

- `<source>` — source directory (files stay in place)
- `--output <target>` — destination root for category folders

**Copy strategy**

- files `< 10MB` → `fs.copyFile`
- files `≥ 10MB` → `pipeline(createReadStream, createWriteStream)`

Name conflicts become `name(1).ext`, `name(2).ext`, …

**Events (`Organizer`)**

- `copy-start`
- `copy-complete`
- `copy-error`

### cleanup

Find files older than N days (by `mtime`). Without `--confirm` this is a dry run; with `--confirm` files are deleted via `fs.unlink`.

```bash
# dry run
node file-organizer.js cleanup /path/to/directory --older-than 90

# delete
node file-organizer.js cleanup /path/to/directory --older-than 90 --confirm
```

**Args**

- `<directory>` — path to scan
- `--older-than <days>` — age threshold in days
- `--confirm` — optional; actually delete matching files

**Events (`Cleanup`)**

- `file-found`
- `file-deleted`
- `cleanup-complete`

## Error handling

All filesystem operations are wrapped in `try/catch`. Known codes:

- `ENOENT` — directory/file not found
- `EACCES` — permission denied
- other — unexpected error message

The process exits with code `1` on failure.

## License

MIT
