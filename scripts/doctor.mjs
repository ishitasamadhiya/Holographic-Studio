// Verifies that everything Holographic Studio needs at runtime is installed and working.
// Usage: npm run doctor
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const results = [];

function check(name, run) {
  try {
    results.push({ name, ok: true, detail: run() });
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
  }
}

check('Node.js 22.12 or newer', () => {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) {
    throw new Error(`found ${process.versions.node}. Install Node 22 LTS from https://nodejs.org`);
  }
  return process.versions.node;
});

check('Dependencies installed', () => {
  if (!existsSync(resolve(root, 'node_modules/electron'))) {
    throw new Error('node_modules is missing. Run: npm install');
  }
  return 'node_modules present';
});

check('FFmpeg (bundled, used for MP4 export)', () => {
  const ffmpegPath = require('ffmpeg-static');
  if (!ffmpegPath || !existsSync(ffmpegPath)) {
    throw new Error('binary missing. Run: npm rebuild ffmpeg-static');
  }
  const firstLine = execFileSync(ffmpegPath, ['-version'], { encoding: 'utf8' }).split('\n')[0];
  return firstLine;
});

check('Hand-tracking model', () => {
  const model = resolve(root, 'src/renderer/public/models/hand_landmarker.task');
  if (!existsSync(model)) throw new Error('missing. Run: node scripts/prepare-assets.mjs');
  return `${(statSync(model).size / 1e6).toFixed(1)} MB`;
});

check('MediaPipe WASM runtime', () => {
  const wasm = resolve(root, 'src/renderer/public/mediapipe/wasm/vision_wasm_internal.wasm');
  if (!existsSync(wasm)) throw new Error('missing. Run: node scripts/prepare-assets.mjs');
  return 'present';
});

let failed = false;
for (const { name, ok, detail } of results) {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed = true;
}

if (failed) {
  console.log('\nSomething is missing. See the Troubleshooting section of README.md.');
  process.exit(1);
}
console.log('\nAll good. Start the app with: npm run dev');
