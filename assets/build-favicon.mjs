// Regenerates /favicon.ico from assets/favicon-square.png at multiple sizes.
// Requires macOS `sips` for the resize step (no extra npm deps).
//
// Usage:
//   node assets/build-favicon.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const sizes = [16, 32, 48, 64, 128, 256];
const source = join(__dirname, 'favicon-square.png');
for (const size of sizes) {
  const out = join(__dirname, `favicon-${size}.png`);
  execFileSync('sips', ['-z', String(size), String(size), source, '--out', out], {
    stdio: 'ignore',
  });
}

const pngs = sizes.map((size) => ({
  size,
  data: readFileSync(join(__dirname, `favicon-${size}.png`)),
}));

const HEADER_SIZE = 6;
const ENTRY_SIZE = 16;
const headerAndEntries = HEADER_SIZE + ENTRY_SIZE * pngs.length;

const header = Buffer.alloc(HEADER_SIZE);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);

const entries = Buffer.alloc(ENTRY_SIZE * pngs.length);
let offset = headerAndEntries;
pngs.forEach((png, idx) => {
  const base = idx * ENTRY_SIZE;
  entries.writeUInt8(png.size >= 256 ? 0 : png.size, base + 0);
  entries.writeUInt8(png.size >= 256 ? 0 : png.size, base + 1);
  entries.writeUInt8(0, base + 2);
  entries.writeUInt8(0, base + 3);
  entries.writeUInt16LE(1, base + 4);
  entries.writeUInt16LE(32, base + 6);
  entries.writeUInt32LE(png.data.length, base + 8);
  entries.writeUInt32LE(offset, base + 12);
  offset += png.data.length;
});

const body = Buffer.concat(pngs.map((p) => p.data));
const ico = Buffer.concat([header, entries, body]);
writeFileSync(join(__dirname, '..', 'favicon.ico'), ico);
console.log(`Wrote favicon.ico (${ico.length} bytes, ${pngs.length} sizes)`);
