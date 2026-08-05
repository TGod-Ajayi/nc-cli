/**
 * A minimal ZIP writer, built on `node:zlib`.
 *
 * NaijaCloud's static-site upload takes a `.zip` (or a single `.html`), and the
 * archive has to exist before the upload slot can be requested — the slot's
 * signature is bound to `sizeBytes`. Node has a deflate implementation but no
 * archive format, so this writes the container: local file headers, a central
 * directory and an end-of-central-directory record.
 *
 * Deliberately not a dependency. The format needed here is the 1989 subset —
 * deflate or store, no encryption, no Zip64 — and pulling a package in for it
 * would cost more in supply-chain surface than it saves in code. Zip64 is the
 * one real limit: entries and archives must stay under 4 GiB, which is far
 * below the upload cap the platform allows anyway.
 */

import { deflateRawSync } from "node:zlib";

/** One file to place in the archive. */
export interface ZipInput {
  /** Path inside the archive, forward-slashed, no leading slash. */
  path: string;
  contents: Buffer;
  /** Modification time, stored in DOS format. Defaults to now. */
  modified?: Date;
}

export interface ZipResult {
  buffer: Buffer;
  /** Total size of the file contents before compression. */
  uncompressedBytes: number;
}

/** ZIP predates 4 GiB files; Zip64 lifts this and is deliberately not implemented. */
const MAX_ENTRY_BYTES = 0xffff_ffff;

const SIGNATURE_LOCAL = 0x04034b50;
const SIGNATURE_CENTRAL = 0x02014b50;
const SIGNATURE_END = 0x06054b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** Bit 11 tells the reader the filename is UTF-8 rather than CP437. */
const FLAG_UTF8 = 0x0800;

/** "Made by" version 2.0, the floor for deflate. */
const VERSION = 20;

/* -------------------------------------------------------------------------- */
/* CRC-32                                                                     */
/* -------------------------------------------------------------------------- */

/** Standard CRC-32 (polynomial 0xEDB88320), table built once on first use. */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(data: Buffer): number {
  let crc = 0xffff_ffff;
  for (let index = 0; index < data.length; index += 1) {
    // Both operands are in range by construction, so the non-null assertions
    // below are safe and keep the inner loop free of branches.
    crc = CRC_TABLE[(crc ^ data[index]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

/* -------------------------------------------------------------------------- */
/* DOS date/time                                                              */
/* -------------------------------------------------------------------------- */

/**
 * MS-DOS packed date and time: two-second resolution, epoch 1980. Anything
 * older than 1980 is clamped rather than wrapping into a nonsensical date.
 */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(date.getFullYear(), 1980);
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f);
  const packedDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time: time & 0xffff, date: packedDate & 0xffff };
}

/* -------------------------------------------------------------------------- */
/* Archive                                                                    */
/* -------------------------------------------------------------------------- */

interface Entry {
  nameBytes: Buffer;
  crc: number;
  method: number;
  compressed: Buffer;
  uncompressedSize: number;
  time: number;
  date: number;
  offset: number;
}

/**
 * Files that are already compressed — the deflate pass on these costs CPU and
 * usually *adds* bytes, so they are stored verbatim.
 */
const PRECOMPRESSED = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "ico",
  "woff", "woff2", "zip", "gz", "br", "mp4", "webm", "mp3", "ogg", "pdf",
]);

function isPrecompressed(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return PRECOMPRESSED.has(path.slice(dot + 1).toLowerCase());
}

/**
 * Builds a ZIP archive in memory.
 *
 * In-memory is a deliberate simplification: `createStaticUpload` needs the exact
 * byte count up front, so the archive cannot be streamed to the network as it is
 * produced, and a static site that would strain the heap is far past the size
 * where this deploy path is the right tool.
 */
export function createZip(inputs: ZipInput[]): ZipResult {
  const chunks: Buffer[] = [];
  const entries: Entry[] = [];
  let offset = 0;
  let uncompressedBytes = 0;

  for (const input of inputs) {
    if (input.contents.length > MAX_ENTRY_BYTES) {
      throw new Error(
        `${input.path} is larger than 4 GiB, which this archive format cannot hold.`,
      );
    }

    const nameBytes = Buffer.from(input.path, "utf8");
    const crc = crc32(input.contents);
    const { time, date } = dosDateTime(input.modified ?? new Date());

    // Store when compression cannot help: already-compressed formats, and any
    // case where deflate came out no smaller than the original.
    let method = METHOD_STORE;
    let payload = input.contents;
    if (!isPrecompressed(input.path) && input.contents.length > 0) {
      const deflated = deflateRawSync(input.contents, { level: 9 });
      if (deflated.length < input.contents.length) {
        method = METHOD_DEFLATE;
        payload = deflated;
      }
    }

    const header = Buffer.allocUnsafe(30);
    header.writeUInt32LE(SIGNATURE_LOCAL, 0);
    header.writeUInt16LE(VERSION, 4);
    header.writeUInt16LE(FLAG_UTF8, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(payload.length, 18);
    header.writeUInt32LE(input.contents.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28); // no extra field

    chunks.push(header, nameBytes, payload);
    entries.push({
      nameBytes,
      crc,
      method,
      compressed: payload,
      uncompressedSize: input.contents.length,
      time,
      date,
      offset,
    });

    offset += header.length + nameBytes.length + payload.length;
    uncompressedBytes += input.contents.length;
  }

  const centralStart = offset;
  for (const entry of entries) {
    const record = Buffer.allocUnsafe(46);
    record.writeUInt32LE(SIGNATURE_CENTRAL, 0);
    record.writeUInt16LE(VERSION, 4); // version made by
    record.writeUInt16LE(VERSION, 6); // version needed
    record.writeUInt16LE(FLAG_UTF8, 8);
    record.writeUInt16LE(entry.method, 10);
    record.writeUInt16LE(entry.time, 12);
    record.writeUInt16LE(entry.date, 14);
    record.writeUInt32LE(entry.crc, 16);
    record.writeUInt32LE(entry.compressed.length, 20);
    record.writeUInt32LE(entry.uncompressedSize, 24);
    record.writeUInt16LE(entry.nameBytes.length, 28);
    record.writeUInt16LE(0, 30); // extra field length
    record.writeUInt16LE(0, 32); // comment length
    record.writeUInt16LE(0, 34); // disk number
    record.writeUInt16LE(0, 36); // internal attributes
    // External attributes: 0644, in the high 16 bits where Unix modes live.
    record.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    record.writeUInt32LE(entry.offset, 42);

    chunks.push(record, entry.nameBytes);
    offset += record.length + entry.nameBytes.length;
  }

  const end = Buffer.allocUnsafe(22);
  end.writeUInt32LE(SIGNATURE_END, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(offset - centralStart, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20); // comment length
  chunks.push(end);

  const buffer = Buffer.concat(chunks);
  if (buffer.length > MAX_ENTRY_BYTES) {
    throw new Error("The archive is larger than 4 GiB, which this format cannot hold.");
  }

  return { buffer, uncompressedBytes };
}
