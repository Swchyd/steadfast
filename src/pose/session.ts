import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { createCounter, type CounterState, type Exercise } from './counter';
import { toPixels, type Joint } from './geometry';

export type StopReason = 'user' | 'hidden' | 'noPerson' | 'cap' | 'error';
export type StartError = 'denied' | 'missing' | 'model';

export interface SessionUpdate {
  state: CounterState;
  fps: number;
  elapsedMs: number;
  joints: Joint[] | null;
  cooledDown: boolean;
}

export interface SessionResult {
  reason: StopReason;
  reps: number;
  holdMs: number;
  durationMs: number;
  avgFps: number;
  delegate: 'GPU' | 'CPU';
  frames: number;
  /** Joint positions per processed frame, kept in memory only until the next session. */
  recording: { t: number; joints: Joint[] | null }[];
}

export interface SessionOptions {
  exercise: Exercise;
  video: HTMLVideoElement;
  onUpdate(update: SessionUpdate): void;
  onStop(result: SessionResult): void;
  maxMs?: number;
}

const TARGET_FPS = 15;
const REDUCED_FPS = 10;
const IDLE_FPS = 2;
const NO_PERSON_STOP_MS = 30_000;
const HARD_CAP_MS = 10 * 60_000;
const SLOW_FPS = 9;
const SLOW_FOR_MS = 5_000;

export interface Session {
  stop(reason?: StopReason): void;
}

/** Starts camera + pose model. Both are loaded here, on demand, and fully released on stop. */
export async function startSession(opts: SessionOptions): Promise<Session | StartError> {
  if (!navigator.mediaDevices?.getUserMedia) return 'missing';

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: TARGET_FPS, max: 30 },
      },
    });
  } catch (err) {
    const name = (err as DOMException)?.name;
    return name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'missing';
  }
  const releaseStream = () => {
    for (const track of stream.getTracks()) track.stop();
    opts.video.srcObject = null;
  };

  let landmarker: PoseLandmarker;
  let delegate: 'GPU' | 'CPU' = 'GPU';
  try {
    const vision = await import('@mediapipe/tasks-vision');
    const files = await vision.FilesetResolver.forVisionTasks(new URL('./wasm', document.baseURI).href);
    const make = (d: 'GPU' | 'CPU') =>
      vision.PoseLandmarker.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: new URL('./models/pose_landmarker_lite.task', document.baseURI).href,
          delegate: d,
        },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
    try {
      landmarker = await make('GPU');
    } catch {
      delegate = 'CPU';
      landmarker = await make('CPU');
    }
  } catch {
    releaseStream();
    return 'model';
  }

  const video = opts.video;
  video.srcObject = stream;
  video.playsInline = true;
  video.muted = true;
  try {
    await video.play();
  } catch {
    landmarker.close();
    releaseStream();
    return 'missing';
  }

  let wakeLock: WakeLockSentinel | null = null;
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      // Optional. The session works without it.
    }
  }

  const counter = createCounter(opts.exercise);
  const cap = Math.min(opts.maxMs ?? HARD_CAP_MS, HARD_CAP_MS);
  const startedAt = performance.now();
  const recording: SessionResult['recording'] = [];
  const recent: number[] = [];
  let frames = 0;
  let lastInferenceAt = -Infinity;
  let lastPersonAt = startedAt;
  let slowSince: number | null = null;
  let targetFps = TARGET_FPS;
  let personPresent = false;
  let running = true;
  let handle = 0;
  const useVideoCallback = 'requestVideoFrameCallback' in video;

  function schedule() {
    handle = useVideoCallback ? video.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
  }

  function tick() {
    if (!running) return;
    const now = performance.now();
    const wanted = personPresent ? targetFps : IDLE_FPS;
    // 0.9 tolerance so a 15 fps camera isn't halved by jitter.
    if (now - lastInferenceAt >= (1000 / wanted) * 0.9 && video.readyState >= 2) {
      lastInferenceAt = now;
      let joints: Joint[] | null = null;
      try {
        const result = landmarker.detectForVideo(video, now);
        const first = result.landmarks?.[0];
        if (first) joints = toPixels(first, video.videoWidth, video.videoHeight);
      } catch {
        stop('error');
        return;
      }
      frames++;
      personPresent = joints !== null;
      if (personPresent) lastPersonAt = now;
      recording.push({ t: Math.round(now - startedAt), joints });

      recent.push(now);
      while (recent.length && now - recent[0] > 2000) recent.shift();
      const fps = recent.length > 1 ? ((recent.length - 1) * 1000) / (now - recent[0]) : 0;

      // Sustained slow inference is our proxy for a hot phone: lower the load once.
      if (personPresent && targetFps === TARGET_FPS && recent.length > 5 && fps < SLOW_FPS) {
        slowSince ??= now;
        if (now - slowSince >= SLOW_FOR_MS) targetFps = REDUCED_FPS;
      } else {
        slowSince = null;
      }

      const state = counter.push(now, joints);
      opts.onUpdate({
        state,
        fps,
        elapsedMs: now - startedAt,
        joints,
        cooledDown: targetFps === REDUCED_FPS,
      });
    }
    if (now - lastPersonAt >= NO_PERSON_STOP_MS) return stop('noPerson');
    if (now - startedAt >= cap) return stop('cap');
    schedule();
  }

  function onVisibility() {
    if (document.hidden) stop('hidden');
  }
  function onPageHide() {
    stop('hidden');
  }

  function stop(reason: StopReason = 'user') {
    if (!running) return;
    running = false;
    if (useVideoCallback) video.cancelVideoFrameCallback(handle);
    else cancelAnimationFrame(handle);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    stream.removeEventListener('inactive', onInactive);
    releaseStream();
    landmarker.close();
    void wakeLock?.release().catch(() => undefined);
    const durationMs = performance.now() - startedAt;
    opts.onStop({
      reason,
      reps: counter.state.reps,
      holdMs: counter.state.holdMs,
      durationMs,
      avgFps: durationMs > 0 ? (frames * 1000) / durationMs : 0,
      delegate,
      frames,
      recording,
    });
  }
  function onInactive() {
    // Permission revoked or camera taken away mid-session.
    stop('error');
  }

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  stream.addEventListener('inactive', onInactive);
  schedule();
  return { stop };
}
