'use strict';
// CBMC current-main T4 R104 evidence capture hook.
// The shared portfolio gateway (tool-portfolio-t4.mjs runPortableGate) writes the
// verify receipt TSV into its private mkdtemp dir and deletes that dir in a
// finally block, so the raw receipt bytes never leave the process. This preload
// hook copies any *.tsv from a directory about to be recursively deleted into
// FT_RECEIPT_CAPTURE_DIR before the original rm runs. It is CBMC-owned evidence
// tooling: no shared Runner/CLI/SDK/MCP source is modified, and the copied bytes
// are exactly the bytes hashed into receipt_sha256 by the gateway.
const fsp = require('node:fs/promises');
const { readdirSync, mkdirSync, copyFileSync } = require('node:fs');
const { join } = require('node:path');
const CAP = process.env.FT_RECEIPT_CAPTURE_DIR;
if (CAP && typeof fsp.rm === 'function') {
  const origRm = fsp.rm;
  fsp.rm = async function captureRm(path, opts) {
    try {
      if (opts && opts.recursive && (typeof path === 'string' || Buffer.isBuffer(path))) {
        const dir = String(path);
        for (const entry of readdirSync(dir)) {
          if (entry.endsWith('.tsv')) {
            mkdirSync(CAP, { recursive: true });
            copyFileSync(join(dir, entry), join(CAP, entry));
          }
        }
      }
    } catch { /* capture is best-effort; never alters deletion semantics */ }
    return origRm.call(this, path, opts);
  };
}
