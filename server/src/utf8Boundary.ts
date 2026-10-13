/**
 * How many leading bytes of `buf` end on a whole UTF-8 character.
 *
 * A transcript read stops wherever the chunk cap or the writer left the file,
 * which can be inside a multibyte character. Decoding that first half alone
 * turns both halves into U+FFFD, so callers decode only this prefix and read
 * the bytes after it again next time.
 *
 * Only a trailing sequence still missing bytes is held back, its lead byte and
 * up to two continuation bytes, so at most 3 bytes. A stray continuation byte
 * or a byte that never starts a sequence decodes now, as U+FFFD: a corrupt tail
 * must never stall the reader.
 */
export function completeUtf8Length(buf: Buffer): number {
  const end = buf.length;
  for (let i = end - 1; i >= Math.max(0, end - 3); i--) {
    const byte = buf[i];
    if ((byte & 0xc0) === 0x80) continue;
    let needed: number;
    if (byte >= 0xc2 && byte <= 0xdf) needed = 2;
    else if (byte >= 0xe0 && byte <= 0xef) needed = 3;
    else if (byte >= 0xf0 && byte <= 0xf4) needed = 4;
    else return end;
    return end - i < needed ? i : end;
  }
  return end;
}
