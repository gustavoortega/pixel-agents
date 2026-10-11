/**
 * Minimal deterministic PNG writer for the cozy art generator.
 *
 * Why not pngjs.write: the compressed bytes depend on the zlib build bundled with
 * the running Node, so a byte-for-byte check would drift across Node versions.
 * Here the IDAT stream uses stored (uncompressed) deflate blocks, which the format
 * defines exactly, so the same pixels always give the same file.
 * Output is always 8-bit RGBA (color type 6), the format the app loads.
 */

const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t.push(c >>> 0);
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(buf: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  return Buffer.concat([u32(data.length), typeAndData, u32(crc32(typeAndData))]);
}

/** Raw RGBA pixels, row-major, 4 bytes per pixel. */
export interface Rgba {
  width: number;
  height: number;
  data: Uint8Array;
}

export function encodePng(img: Rgba): Buffer {
  const { width, height, data } = img;
  if (data.length !== width * height * 4) {
    throw new Error(`encodePng: expected ${width * height * 4} bytes, got ${data.length}`);
  }
  // Filter type 0 (none) on every scanline.
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const o = y * (1 + width * 4);
    raw[o] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, o + 1);
  }
  // zlib stream: header, stored blocks of at most 65535 bytes, adler32.
  const parts: Buffer[] = [Buffer.from([0x78, 0x01])];
  for (let pos = 0; pos < raw.length || pos === 0; pos += 65535) {
    const len = Math.min(65535, raw.length - pos);
    const last = pos + len >= raw.length;
    const head = Buffer.alloc(5);
    head[0] = last ? 1 : 0;
    head.writeUInt16LE(len, 1);
    head.writeUInt16LE(~len & 0xffff, 3);
    parts.push(head, raw.subarray(pos, pos + len));
    if (last) {
      break;
    }
  }
  parts.push(u32(adler32(raw)));

  const ihdr = Buffer.concat([u32(width), u32(height), Buffer.from([8, 6, 0, 0, 0])]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', Buffer.concat(parts)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
