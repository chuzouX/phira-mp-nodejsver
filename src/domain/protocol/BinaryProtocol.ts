/*
 * MIT License
 * Copyright (c) 2024
 */

export class BinaryReader {
  private data: Buffer;
  private position: number;

  constructor(data: Buffer) {
    this.data = data;
    this.position = 0;
  }

  byte(): number {
    if (this.position >= this.data.length) {
      throw new Error('Unexpected EOF');
    }
    return this.data[this.position++];
  }

  take(n: number): Buffer {
    if (this.position + n > this.data.length) {
      throw new Error('Unexpected EOF');
    }
    const result = this.data.subarray(this.position, this.position + n);
    this.position += n;
    return result;
  }

  uleb(): bigint {
    let result = 0n;
    let shift = 0n;
    while (true) {
      const byte = this.byte();
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        return result;
      }
      shift += 7n;
    }
  }

  u8(): number {
    return this.byte();
  }

  u16(): number {
    const bytes = this.take(2);
    return bytes.readUInt16LE(0);
  }

  u32(): number {
    const bytes = this.take(4);
    return bytes.readUInt32LE(0);
  }

  u64(): bigint {
    const bytes = this.take(8);
    return bytes.readBigUInt64LE(0);
  }

  i8(): number {
    return this.byte() << 24 >> 24;
  }

  i16(): number {
    const bytes = this.take(2);
    return bytes.readInt16LE(0);
  }

  i32(): number {
    const bytes = this.take(4);
    return bytes.readInt32LE(0);
  }

  i64(): bigint {
    const bytes = this.take(8);
    return bytes.readBigInt64LE(0);
  }

  f32(): number {
    const bytes = this.take(4);
    return bytes.readFloatLE(0);
  }

  f64(): number {
    const bytes = this.take(8);
    return bytes.readDoubleLE(0);
  }

  bool(): boolean {
    return this.byte() === 1;
  }

  string(): string {
    const len = Number(this.uleb());
    const bytes = this.take(len);
    return bytes.toString('utf8');
  }

  array<T>(readElement: () => T): T[] {
    const len = Number(this.uleb());
    const result: T[] = [];
    for (let i = 0; i < len; i++) {
      result.push(readElement());
    }
    return result;
  }

  hasMore(): boolean {
    return this.position < this.data.length;
  }

  remaining(): number {
    return this.data.length - this.position;
  }

  readRemaining(): Buffer {
    const result = this.data.subarray(this.position);
    this.position = this.data.length;
    return result;
  }
}

export class BinaryWriter {
  private buffer: Buffer[];

  constructor() {
    this.buffer = [];
  }

  byte(value: number): void {
    this.buffer.push(Buffer.from([value & 0xff]));
  }

  uleb(value: bigint | number): void {
    let v = BigInt(value);
    while (true) {
      let byte = Number(v & 0x7fn);
      v >>= 7n;
      if (v !== 0n) {
        byte |= 0x80;
      }
      this.byte(byte);
      if (v === 0n) {
        break;
      }
    }
  }

  u8(value: number): void {
    this.byte(value);
  }

  u16(value: number): void {
    const buf = Buffer.allocUnsafe(2);
    buf.writeUInt16LE(value, 0);
    this.buffer.push(buf);
  }

  u32(value: number): void {
    const buf = Buffer.allocUnsafe(4);
    buf.writeUInt32LE(value, 0);
    this.buffer.push(buf);
  }

  u64(value: bigint): void {
    const buf = Buffer.allocUnsafe(8);
    buf.writeBigUInt64LE(value, 0);
    this.buffer.push(buf);
  }

  i8(value: number): void {
    this.byte(value);
  }

  i16(value: number): void {
    const buf = Buffer.allocUnsafe(2);
    buf.writeInt16LE(value, 0);
    this.buffer.push(buf);
  }

  i32(value: number): void {
    const buf = Buffer.allocUnsafe(4);
    buf.writeInt32LE(value, 0);
    this.buffer.push(buf);
  }

  i64(value: bigint): void {
    const buf = Buffer.allocUnsafe(8);
    buf.writeBigInt64LE(value, 0);
    this.buffer.push(buf);
  }

  f32(value: number): void {
    const buf = Buffer.allocUnsafe(4);
    buf.writeFloatLE(value, 0);
    this.buffer.push(buf);
  }

  f64(value: number): void {
    const buf = Buffer.allocUnsafe(8);
    buf.writeDoubleLE(value, 0);
    this.buffer.push(buf);
  }

  bool(value: boolean): void {
    this.byte(value ? 1 : 0);
  }

  string(value: string): void {
    const buf = Buffer.from(value, 'utf8');
    this.uleb(buf.length);
    this.buffer.push(buf);
  }

  array<T>(values: T[], writeElement: (value: T) => void): void {
    this.uleb(values.length);
    for (const value of values) {
      writeElement(value);
    }
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.buffer);
  }
}
