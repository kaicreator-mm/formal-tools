#!/usr/bin/env node
/**
 * Strict streaming reconstruction for the original Lean4 4.35.0 tar.zst.
 *
 * This script NEVER downloads, extracts, executes, or repairs tool binaries.
 * It only concatenates known, fixed-size parts in pinned order; verifies the
 * resulting original source SHA256 and byte count; and publishes atomically
 * without replacing an existing destination file.
 *
 * Usage:
 *   node scripts/reassemble-lean4-chunks.mjs --parts-dir /path/to/downloads --output /path/to/lean4-4.35.0-linux-x86_64.tar.zst
 *
 * Pair this with zstd -t and strict tar-member preflight before extraction.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, link, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST_URL = new URL("../docs/tool-portfolio/r3/LEAN4_CHUNKS.json", import.meta.url);

export async function assembleVerifiedParts({ partsDir, outputFile, parts, expectedBytes, expectedSha256 }) {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1) throw new Error("Invalid expected total byte count");
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error("Invalid source SHA256");
  if (!Array.isArray(parts) || !parts.length) throw new Error("Missing parts");
  const target = resolve(outputFile);
  const inputDir = resolve(partsDir);
  const inputPaths = parts.map((part, i) => {
    if (!part || part.part_index !== i || !/^[A-Za-z0-9_.-]+$/.test(part.file_name) || part.file_name === "." || part.file_name === "..") {
      throw new Error(`Bad or unordered part entry at index ${i}`);
    }
    if (!Number.isSafeInteger(part.expected_size_bytes) || part.expected_size_bytes < 1) {
      throw new Error(`Invalid expected part size ${i}`);
    }
    return join(inputDir, part.file_name);
  });
  if (inputPaths.includes(target)) throw new Error("Output may not replace a source part");
  if (parts.reduce((sum, p) => sum + p.expected_size_bytes, 0) !== expectedBytes) {
    throw new Error("Manifest part sizes do not equal original archive size");
  }

  // Preflight all parts before creating any output.
  for (let i = 0; i < parts.length; i++) {
    const stat = await lstat(inputPaths[i]);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== parts[i].expected_size_bytes) {
      throw new Error(`Part ${i} missing, unsafe or mismatched: ${inputPaths[i]}`);
    }
  }

  await mkdir(dirname(target), { recursive: true });
  const partial = `${target}.unverified-${process.pid}`;
  const hash = createHash("sha256");
  let total = 0;
  let fh;
  try {
    fh = await open(partial, "wx", 0o600);
    for (let i = 0; i < inputPaths.length; i++) {
      let segment = 0;
      for await (const chunk of createReadStream(inputPaths[i], { highWaterMark: 1024 * 1024 })) {
        segment += chunk.length;
        total += chunk.length;
        if (segment > parts[i].expected_size_bytes || total > expectedBytes) throw new Error("Part grew during reading");
        hash.update(chunk);
        let written = 0;
        while (written < chunk.length) {
          const { bytesWritten } = await fh.write(chunk, written, chunk.length - written);
          if (bytesWritten === 0) throw new Error("Zero-byte output write");
          written += bytesWritten;
        }
      }
      if (segment !== parts[i].expected_size_bytes) throw new Error(`Part ${i} changed during reading`);
    }
    if (total !== expectedBytes) throw new Error(`Reconstructed length mismatch: ${total}`);
    const actualSha256 = hash.digest("hex");
    if (actualSha256 !== expectedSha256) {
      throw new Error(`Reconstructed SHA256 mismatch: ${actualSha256}; expected ${expectedSha256}`);
    }
    await fh.sync();
    await fh.close();
    fh = null;
    // Do not overwrite existing output: separate reconstructions should be compared explicitly.
    await link(partial, target);
    await unlink(partial);
    return { outputFile: target, sizeBytes: total, sha256: actualSha256 };
  } finally {
    if (fh) await fh.close();
    await unlink(partial).catch((err) => { if (err.code !== "ENOENT") throw err; });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const input = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--parts-dir", "--output"].includes(argv[i]) || !argv[i + 1] || input[argv[i]]) {
      throw new Error("Usage: node scripts/reassemble-lean4-chunks.mjs --parts-dir DIR --output ARCHIVE");
    }
    input[argv[i]] = argv[i + 1];
  }
  if (!input["--parts-dir"] || !input["--output"]) {
    throw new Error("Both --parts-dir and --output are required");
  }
  const { readFile } = await import("node:fs/promises");
  const manifest = JSON.parse(await readFile(MANIFEST_URL, "utf8"));
  if (manifest.schema !== "formal-tools/lean4-split-transport/1.0" ||
      manifest.original_archive_name !== "lean4-4.35.0-linux-x86_64.tar.zst" ||
      manifest.parts.length !== 5) throw new Error("Unexpected pinned Lean4 manifest");
  const answer = await assembleVerifiedParts({
    partsDir: input["--parts-dir"], outputFile: input["--output"],
    parts: manifest.parts,
    expectedBytes: manifest.original_archive_size_bytes,
    expectedSha256: manifest.original_archive_sha256
  });
  process.stdout.write(JSON.stringify({ status: "REASSEMBLED_SHA256_MATCH_ONLY", ...answer }, null, 2) + "\n");
  process.stdout.write("NEXT: zstd -t, strict tar security preflight, isolated native positive/negative/error runner tests.\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err.stack || String(err)); process.exitCode = 1; });
}
