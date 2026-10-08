import './style.css';
import type { Exercise } from './pose/counter';
import type { Joint } from './pose/geometry';
import { startSession, type Session, type SessionResult, type SessionUpdate } from './pose/session';
import { S } from './strings';

type Props = Record<string, string | boolean | ((e: Event) => void)>;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'function') node.addEventListener(key, value);
    else if (typeof value === 'boolean') {
      if (value) node.setAttribute(key, '');
    } else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

interface BatteryReading {
  level: number;
  charging: boolean;
}
interface SavedResult {
  when: string;
  exercise: Exercise;
  counted: number;
  actual: number | null;
  seconds: number;
  avgFps: number;
  engine: string;
  batteryStart: number | null;
  batteryEnd: number | null;
  charging: boolean | null;
  stop: string;
}

const RESULTS_KEY = 'steadfast.m0.results';

async function readBattery(): Promise<BatteryReading | null> {
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryReading> };
  if (typeof nav.getBattery !== 'function') return null;
  try {
    const b = await nav.getBattery();
    return { level: Math.round(b.level * 100), charging: b.charging };
  } catch {
    return null;
  }
}

function loadResults(): SavedResult[] {
  try {
    return JSON.parse(localStorage.getItem(RESULTS_KEY) ?? '[]') as SavedResult[];
  } catch {
    return [];
  }
}

function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

let exercise: Exercise = 'pushup';
let session: Session | null = null;
let last: { result: SessionResult; exercise: Exercise; start: BatteryReading | null; end: BatteryReading | null } | null =
  null;
let engine = '';

// --- home screen ---
const exerciseButtons = (Object.keys(S.exercises) as Exercise[]).map((key) =>
  el(
    'button',
    {
      type: 'button',
      'aria-pressed': String(key === exercise),
      click: () => {
        exercise = key;
        exerciseButtons.forEach((b, i) =>
          b.setAttribute('aria-pressed', String((Object.keys(S.exercises) as Exercise[])[i] === key)),
        );
      },
    },
    S.exercises[key],
  ),
);
const startButton = el('button', { type: 'button', class: 'primary', click: () => void begin() }, S.start);
const notice = el('p', { class: 'notice', role: 'status', hidden: true });
const updateBar = el('p', { class: 'notice', role: 'status', hidden: true });

const summaryList = el('dl');
const actualInput = el('input', { type: 'number', inputmode: 'numeric', min: '0', id: 'actual' });
const saveButton = el('button', { type: 'button', click: saveResult }, S.save);
const recordingButton = el('button', { type: 'button', click: downloadRecording }, S.recording);
const summaryCard = el(
  'section',
  { class: 'card', hidden: true },
  el('h2', {}, S.summary),
  summaryList,
  el('p', {}, el('label', { for: 'actual' }, S.actual), actualInput),
  el('div', { class: 'row' }, saveButton, recordingButton),
  el('p', { class: 'muted' }, S.recordingNote),
);

const resultsList = el('ul');
const copyButton = el('button', { type: 'button', click: () => void copyResults() }, S.copy);
const copyStatus = el('span', { class: 'muted', role: 'status' });
const deviceList = el('dl');

document.getElementById('app')!.append(
  el('h1', {}, S.appName),
  el('p', { class: 'muted' }, S.subtitle),
  updateBar,
  el(
    'section',
    { class: 'card' },
    el('h2', {}, S.pick),
    el('div', { class: 'row' }, ...exerciseButtons),
    el('p', { class: 'muted' }, S.setup),
    startButton,
  ),
  notice,
  summaryCard,
  el(
    'section',
    { class: 'card' },
    el('h2', {}, S.results),
    resultsList,
    el('div', { class: 'row' }, copyButton, copyStatus),
  ),
  el('section', { class: 'card' }, el('h2', {}, S.device), deviceList),
  el('p', { class: 'muted' }, S.honor),
);

// --- camera screen ---
const video = el('video', { playsinline: true, muted: true });
const canvas = el('canvas');
const guide = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
guide.setAttribute('viewBox', '0 0 100 100');
guide.setAttribute('preserveAspectRatio', 'none');
guide.setAttribute('aria-hidden', 'true');
guide.innerHTML =
  '<g fill="none" stroke="#00E5FF" stroke-width="0.6" vector-effect="non-scaling-stroke">' +
  '<path d="M6 16V8h8M86 8h8v8M94 84v8h-8M14 92H6v-8"/>' +
  '<path d="M6 86H94" stroke-dasharray="2 2"/></g>';
const countValue = el('strong', {}, '0');
const countUnit = el('span', {}, S.reps);
const hintLine = el('p', { class: 'hint', role: 'status' }, S.loading);
const metaLine = el('p', { class: 'meta' });
const coolLine = el('p', { class: 'hint warn', hidden: true }, S.coolDown);
const stopButton = el('button', { type: 'button', class: 'primary', click: () => session?.stop('user') }, S.stop);
const cam = el(
  'div',
  { class: 'cam', hidden: true },
  el('div', { class: 'stage' }, video, canvas, guide as unknown as Node),
  el('div', { class: 'hud' }, el('div', { class: 'count' }, countValue, countUnit), hintLine, coolLine, metaLine, stopButton),
);
document.body.append(cam);

const BONES: [number, number][] = [
  [11, 13],
  [13, 15],
  [11, 23],
  [23, 25],
  [25, 27],
];

function draw(joints: Joint[] | null, side: 'left' | 'right' | null, warn: boolean) {
  if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
  if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!joints || !side) return;
  const offset = side === 'left' ? 0 : 1;
  ctx.strokeStyle = warn ? '#FFB020' : '#00E5FF';
  ctx.lineWidth = Math.max(3, canvas.width / 160);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const [a, b] of BONES) {
    ctx.moveTo(joints[a + offset].x, joints[a + offset].y);
    ctx.lineTo(joints[b + offset].x, joints[b + offset].y);
  }
  ctx.stroke();
}

function onUpdate(u: SessionUpdate) {
  const plank = exercise === 'plank';
  countValue.textContent = plank ? clock(u.state.holdMs) : String(u.state.reps);
  const hint = u.state.hint;
  hintLine.textContent = hint ? `! ${S.hints[hint]}` : u.state.tracking ? `✓ ${S.hints.tracking}` : S.hints.noPerson;
  hintLine.classList.toggle('warn', hint !== null);
  coolLine.hidden = !u.cooledDown;
  const angle = u.state.angle === null ? '–' : `${Math.round(u.state.angle)}°`;
  metaLine.textContent = `${u.fps.toFixed(1)} ${S.fps} · ${clock(u.elapsedMs)} · ${angle}`;
  draw(u.joints, u.state.side, hint !== null);
}

async function begin() {
  notice.hidden = true;
  startButton.disabled = true;
  countUnit.textContent = exercise === 'plank' ? S.held : S.reps;
  countValue.textContent = exercise === 'plank' ? '0:00' : '0';
  hintLine.textContent = S.loading;
  hintLine.classList.remove('warn');
  metaLine.textContent = '';
  coolLine.hidden = true;
  cam.hidden = false;
  const start = await readBattery();
  const started = exercise;
  const outcome = await startSession({
    exercise: started,
    video,
    onUpdate,
    onStop: (result) => void finish(result, started, start),
  });
  if (typeof outcome === 'string') {
    cam.hidden = true;
    startButton.disabled = false;
    notice.textContent =
      outcome === 'denied' ? S.cameraDenied : outcome === 'model' ? S.modelFailed : S.cameraMissing;
    notice.hidden = false;
    // Never block: offer manual entry straight away.
    last = null;
    showSummary(null, started, null, null);
    return;
  }
  session = outcome;
}

async function finish(result: SessionResult, started: Exercise, start: BatteryReading | null) {
  session = null;
  cam.hidden = true;
  startButton.disabled = false;
  engine = result.delegate;
  const end = await readBattery();
  last = { result, exercise: started, start, end };
  if (result.reason !== 'user') {
    notice.textContent = S.stopReasons[result.reason];
    notice.hidden = false;
  }
  showSummary(result, started, start, end);
  void showDevice();
}

function showSummary(
  result: SessionResult | null,
  started: Exercise,
  start: BatteryReading | null,
  end: BatteryReading | null,
) {
  const rows: [string, string][] = [];
  if (result) {
    const counted = started === 'plank' ? `${Math.round(result.holdMs / 1000)} s` : `${result.reps} ${S.reps}`;
    rows.push([S.counted, `${S.exercises[started]}: ${counted}`]);
    rows.push([S.duration, clock(result.durationMs)]);
    rows.push([S.avgFps, `${result.avgFps.toFixed(1)} ${S.fps} (${result.delegate})`]);
    rows.push([
      S.battery,
      start && end ? `${start.level}% → ${end.level}%${end.charging ? ' (charging)' : ''}` : S.batteryUnknown,
    ]);
  } else {
    rows.push([S.counted, `${S.exercises[started]}: –`]);
  }
  summaryList.replaceChildren(...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
  actualInput.value = '';
  recordingButton.hidden = !result;
  summaryCard.hidden = false;
  summaryCard.scrollIntoView({ block: 'nearest' });
}

function saveResult() {
  const actual = actualInput.value === '' ? null : Number(actualInput.value);
  const r = last?.result;
  const ex = last?.exercise ?? exercise;
  const entry: SavedResult = {
    when: new Date().toISOString(),
    exercise: ex,
    counted: r ? (ex === 'plank' ? Math.round(r.holdMs / 1000) : r.reps) : 0,
    actual,
    seconds: r ? Math.round(r.durationMs / 1000) : 0,
    avgFps: r ? Math.round(r.avgFps * 10) / 10 : 0,
    engine: r ? r.delegate : 'manual',
    batteryStart: last?.start?.level ?? null,
    batteryEnd: last?.end?.level ?? null,
    charging: last?.end?.charging ?? null,
    stop: r ? r.reason : 'manual',
  };
  const results = [...loadResults(), entry];
  try {
    localStorage.setItem(RESULTS_KEY, JSON.stringify(results));
  } catch {
    // Storage full or blocked: the result is still shown on screen below for this visit.
  }
  summaryCard.hidden = true;
  renderResults(results);
}

function describe(r: SavedResult): string {
  const unit = r.exercise === 'plank' ? 's' : S.reps;
  let text = `${S.exercises[r.exercise]}: ${r.counted} ${unit}`;
  if (r.actual !== null) {
    text += ` / ${r.actual} real`;
    if (r.actual > 0 && r.engine !== 'manual') {
      const acc = Math.max(0, 100 - (Math.abs(r.counted - r.actual) / r.actual) * 100);
      text += ` = ${Math.round(acc)}% ${S.accuracy}`;
    }
  }
  text += ` · ${clock(r.seconds * 1000)} · ${r.avgFps} ${S.fps} ${r.engine}`;
  if (r.batteryStart !== null && r.batteryEnd !== null) {
    text += ` · ${S.battery.toLowerCase()} ${r.batteryStart}% → ${r.batteryEnd}%${r.charging ? ' (charging)' : ''}`;
  }
  return `${new Date(r.when).toLocaleString()} · ${text} · ${r.stop}`;
}

function renderResults(results = loadResults()) {
  resultsList.replaceChildren(
    ...(results.length ? results.map((r) => el('li', {}, describe(r))).reverse() : [el('li', {}, S.noResults)]),
  );
  copyButton.hidden = results.length === 0;
}

async function copyResults() {
  const text = loadResults().map(describe).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    copyStatus.textContent = S.copied;
  } catch {
    copyStatus.textContent = text;
  }
}

function downloadRecording() {
  if (!last) return;
  const { result, exercise: ex } = last;
  const frames = result.recording.map((f) => ({
    t: f.t,
    joints: f.joints?.map((j) => [Math.round(j.x * 10) / 10, Math.round(j.y * 10) / 10, Math.round(j.v * 100) / 100]) ?? null,
  }));
  const blob = new Blob([JSON.stringify({ exercise: ex, counted: result.reps, holdMs: result.holdMs, frames })], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: `steadfast-${ex}-${Date.now()}.json` });
  link.click();
  URL.revokeObjectURL(url);
}

async function showDevice() {
  const yn = (ok: boolean) => (ok ? S.yes : S.no);
  const rows: [string, string][] = [
    [S.features.camera, yn(!!navigator.mediaDevices?.getUserMedia)],
    [S.features.wakeLock, yn('wakeLock' in navigator)],
    [S.features.battery, yn('getBattery' in navigator)],
  ];
  if (navigator.storage?.persisted) {
    rows.push([S.features.persist, yn(await navigator.storage.persisted().catch(() => false))]);
  } else rows.push([S.features.persist, S.no]);
  if (navigator.storage?.estimate) {
    const est = await navigator.storage.estimate().catch(() => null);
    if (est?.usage !== undefined) rows.push([S.features.storage, `${(est.usage / 1_048_576).toFixed(1)} MB`]);
  }
  if (engine) rows.push([S.features.engine, engine]);
  deviceList.replaceChildren(...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
}

renderResults();
void showDevice();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('./sw.js').then((reg) => {
    const offer = (worker: ServiceWorker) => {
      updateBar.replaceChildren(
        `${S.update} `,
        el('button', { type: 'button', click: () => worker.postMessage('skip-waiting') }, S.updateAction),
      );
      updateBar.hidden = false;
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
      });
    });
  });
  let reloaded = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !hadController) return;
    reloaded = true;
    location.reload();
  });
}
