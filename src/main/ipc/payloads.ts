// Defensive decoding of values that arrive from the UI process. The UI is our own code, but
// the main process still treats every argument as untrusted input.
import { extname, isAbsolute } from 'node:path';
import { types } from 'node:util';
import { isTakeId } from '../takes/takeFiles';

const MAX_PATH_LENGTH = 4096;

/**
 * Binary data sent over IPC shows up as an ArrayBuffer, a Uint8Array or a Node Buffer
 * depending on what the sender passed. Returns a byte view of any of them, or null.
 */
export function toBytes(value: unknown): Uint8Array | null {
  if (types.isUint8Array(value)) return value;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (types.isAnyArrayBuffer(value)) return new Uint8Array(value);
  return null;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A usable absolute filesystem path: a string, not absurdly long, without NUL bytes. */
export function isAbsolutePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_PATH_LENGTH &&
    !value.includes('\0') &&
    isAbsolute(value)
  );
}

export function isMp4Path(value: unknown): value is string {
  return isAbsolutePath(value) && extname(value).toLowerCase() === '.mp4';
}

export interface ParsedExportRequest {
  takeId: string;
  outputPath: string;
  artworkPng?: Uint8Array;
}

/**
 * Validates an ExportRequest from the UI. Null means the request is malformed.
 *
 * Trust assumption: any absolute *.mp4 path is accepted (and replaced if it exists), not only
 * one the save dialog returned. That is safe only because the bridge answers nothing but the
 * app's own sandboxed, context-isolated page (see trustedSender.ts); the page is trusted to
 * pass the path the user chose.
 */
export function parseExportRequest(value: unknown): ParsedExportRequest | null {
  if (!isPlainObject(value)) return null;
  const { takeId, outputPath, artworkPng } = value;
  if (!isTakeId(takeId) || !isMp4Path(outputPath)) return null;
  if (artworkPng === undefined || artworkPng === null) return { takeId, outputPath };
  const artworkBytes = toBytes(artworkPng);
  return artworkBytes ? { takeId, outputPath, artworkPng: artworkBytes } : null;
}
