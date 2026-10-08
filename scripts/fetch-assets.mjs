// Copies the MediaPipe wasm runtime out of node_modules, downloads the pose model once,
// and draws the app icons. Everything ends up self-hosted under public/.
import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');

const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
cpSync(wasmSrc, join(pub, 'wasm'), { recursive: true });

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';
const modelPath = join(pub, 'models', 'pose_landmarker_lite.task');
if (!existsSync(modelPath) || statSync(modelPath).size < 1_000_000) {
  mkdirSync(dirname(modelPath), { recursive: true });
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Model download failed: ${res.status}`);
  writeFileSync(modelPath, Buffer.from(await res.arrayBuffer()));
  console.log('Downloaded pose model', statSync(modelPath).size, 'bytes');
}

// --- icons (original art: corner brackets + two rising chevrons) ---
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
}
function icon(size) {
  const bg = [0x0a, 0x0e, 0x14];
  const cyan = [0x00, 0xe5, 0xff];
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const t = size * 0.035;
  const lo = size * 0.2;
  const hi = size * 0.8;
  const arm = size * 0.14;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const nearX = Math.abs(x - lo) < t || Math.abs(x - hi) < t;
      const nearY = Math.abs(y - lo) < t || Math.abs(y - hi) < t;
      const inX = x > lo - t && x < hi + t;
      const inY = y > lo - t && y < hi + t;
      const armX = x < lo + arm || x > hi - arm;
      const armY = y < lo + arm || y > hi - arm;
      const bracket = (nearX && inY && armY) || (nearY && inX && armX);
      const dx = Math.abs(x - size / 2);
      const chevron = (top) => dx < size * 0.16 && Math.abs(y - top - dx) < t * 1.3;
      const on = bracket || chevron(size * 0.36) || chevron(size * 0.5);
      const c = on ? cyan : bg;
      raw[row + 1 + x * 3] = c[0];
      raw[row + 2 + x * 3] = c[1];
      raw[row + 3 + x * 3] = c[2];
    }
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0);
  head.writeUInt32BE(size, 4);
  head[8] = 8;
  head[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', head),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
mkdirSync(join(pub, 'icons'), { recursive: true });
for (const size of [192, 512]) writeFileSync(join(pub, 'icons', `icon-${size}.png`), icon(size));
