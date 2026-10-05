import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isAbsolutePath, isMp4Path, isPlainObject, parseExportRequest, toBytes } from './payloads';

describe('toBytes', () => {
  it('views an ArrayBuffer without copying', () => {
    const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
    const bytes = toBytes(buffer);
    expect([...bytes!]).toEqual([1, 2, 3, 4]);
    expect(bytes!.buffer).toBe(buffer);
  });

  it('passes Uint8Arrays and Node Buffers through, respecting their offsets', () => {
    const whole = new Uint8Array([9, 1, 2, 3, 9]);
    const view = whole.subarray(1, 4);
    expect(toBytes(view)).toBe(view);
    const nodeBuffer = Buffer.from(whole.buffer, 1, 3);
    expect([...toBytes(nodeBuffer)!]).toEqual([1, 2, 3]);
  });

  it('views other typed arrays as their raw bytes', () => {
    const floats = new Float32Array([1, -2]);
    const bytes = toBytes(floats.subarray(1));
    expect(bytes!.byteLength).toBe(4);
    expect(new Float32Array(bytes!.buffer, bytes!.byteOffset, 1)[0]).toBe(-2);
  });

  it.each([null, undefined, 'bytes', 42, [1, 2, 3], { byteLength: 4 }])('rejects %j', (value) => {
    expect(toBytes(value)).toBeNull();
  });
});

describe('path checks', () => {
  it('accepts only sane absolute paths', () => {
    expect(isAbsolutePath('/Users/singer/Movies/take.mp4')).toBe(true);
    expect(isAbsolutePath('take.mp4')).toBe(false);
    expect(isAbsolutePath('./take.mp4')).toBe(false);
    expect(isAbsolutePath('')).toBe(false);
    expect(isAbsolutePath('/tmp/evil\0.mp4')).toBe(false);
    expect(isAbsolutePath(`/${'x'.repeat(5000)}`)).toBe(false);
    expect(isAbsolutePath(42)).toBe(false);
    expect(isAbsolutePath(null)).toBe(false);
  });

  it('recognises .mp4 destinations in any letter case', () => {
    expect(isMp4Path('/out/take.mp4')).toBe(true);
    expect(isMp4Path('/out/TAKE.MP4')).toBe(true);
    expect(isMp4Path('/out/take.mov')).toBe(false);
    expect(isMp4Path('/out/take')).toBe(false);
    expect(isMp4Path('take.mp4')).toBe(false);
  });

  it('isPlainObject excludes arrays and null', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject('x')).toBe(false);
  });
});

describe('parseExportRequest', () => {
  const takeId = randomUUID();

  it('accepts a valid request, with or without artwork', () => {
    expect(parseExportRequest({ takeId, outputPath: '/out/take.mp4' })).toEqual({
      takeId,
      outputPath: '/out/take.mp4',
    });
    const artwork = new Uint8Array([137, 80, 78, 71]).buffer;
    const parsed = parseExportRequest({ takeId, outputPath: '/out/take.mp4', artworkPng: artwork });
    expect([...parsed!.artworkPng!]).toEqual([137, 80, 78, 71]);
  });

  it.each([
    ['a missing take id', { outputPath: '/out/take.mp4' }],
    ['a take id that is a path', { takeId: '../../etc', outputPath: '/out/take.mp4' }],
    ['a relative destination', { takeId, outputPath: 'take.mp4' }],
    ['a destination that is not an mp4', { takeId, outputPath: '/out/take.sh' }],
    ['artwork that is not binary', { takeId, outputPath: '/out/take.mp4', artworkPng: 'png' }],
    ['a non-object', 'export please'],
    ['null', null],
  ])('rejects %s', (_name, request) => {
    expect(parseExportRequest(request)).toBeNull();
  });
});
