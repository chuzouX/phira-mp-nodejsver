import * as fs from 'fs';

export class BinaryWriter {
  private chunks: Buffer[] = [];

  byte(v: number): void { this.chunks.push(Buffer.from([v & 0xff])); }

  uleb(v: bigint | number): void {
    let val = BigInt(v);
    while (true) {
      let b = Number(val & 0x7fn);
      val >>= 7n;
      if (val !== 0n) b |= 0x80;
      this.byte(b);
      if (val === 0n) break;
    }
  }

  u8(v: number): void { this.byte(v); }

  u16(v: number): void {
    const b = Buffer.allocUnsafe(2);
    b.writeUInt16LE(v, 0);
    this.chunks.push(b);
  }

  i8(v: number): void { this.byte(v); }

  i16(v: number): void {
    const b = Buffer.allocUnsafe(2);
    b.writeInt16LE(v, 0);
    this.chunks.push(b);
  }

  i32(v: number): void {
    const b = Buffer.allocUnsafe(4);
    b.writeInt32LE(v, 0);
    this.chunks.push(b);
  }

  bool(v: boolean): void { this.byte(v ? 1 : 0); }

  string(v: string): void {
    const buf = Buffer.from(v, 'utf8');
    this.uleb(buf.length);
    this.chunks.push(buf);
  }

  bytes(v: Buffer): void { this.chunks.push(v); }

  array<T>(values: T[], fn: (v: T) => void): void {
    this.uleb(values.length);
    for (const v of values) fn(v);
  }

  toBuffer(): Buffer { return Buffer.concat(this.chunks); }
}

export class BinaryReader {
  pos = 0;
  constructor(readonly data: Buffer) {}

  byte(): number {
    if (this.pos >= this.data.length) throw new Error('EOF');
    return this.data[this.pos++];
  }

  take(n: number): Buffer {
    if (this.pos + n > this.data.length) throw new Error('EOF');
    const r = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return r;
  }

  uleb(): bigint {
    let result = 0n; let shift = 0n;
    while (true) {
      const b = this.byte();
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return result;
      shift += 7n;
    }
  }

  u8(): number { return this.byte(); }
  u16(): number { return this.take(2).readUInt16LE(0); }

  string(): string {
    const len = Number(this.uleb());
    return this.take(len).toString('utf8');
  }

  bool(): boolean { return this.byte() === 1; }

  array<T>(fn: () => T): T[] {
    const len = Number(this.uleb());
    const r: T[] = [];
    for (let i = 0; i < len; i++) r.push(fn());
    return r;
  }

  hasMore(): boolean { return this.pos < this.data.length; }
}

export function buildPacket(commandType: number, body: Buffer): Buffer {
  const w = new BinaryWriter();
  w.uleb(body.length + 1);
  w.byte(commandType);
  w.bytes(body);
  return w.toBuffer();
}

export function parseHeader(buf: Buffer): { commandType: number; body: Buffer; consumed: number } | null {
  const r = new BinaryReader(buf);
  if (r.data.length === 0) return null;
  try {
    const len = Number(r.uleb());
    const commandType = r.u8();
    if (r.pos + len - 1 > r.data.length) return null;
    const body = r.take(len - 1);
    return { commandType, body, consumed: r.pos };
  } catch {
    return null;
  }
}
