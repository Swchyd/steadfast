import { angleAt, tiltFromHorizontal, type Joint } from './geometry';

export type Exercise = 'pushup' | 'squat' | 'plank';

export type Hint =
  | 'noPerson'
  | 'stepBack'
  | 'getIntoPosition'
  | 'goLower'
  | 'hipsInLine'
  | 'straighten'
  | null;

export interface CounterState {
  reps: number;
  /** Plank only: milliseconds held with good form. */
  holdMs: number;
  phase: 'idle' | 'up' | 'down';
  hint: Hint;
  /** Smoothed joint angle being tracked, for the on-screen readout. */
  angle: number | null;
  tracking: boolean;
  side: 'left' | 'right' | null;
}

export interface CounterConfig {
  minVisibility: number;
  /** Frames in a row needed before tracking switches on or off. */
  confirmFrames: number;
  smoothing: number;
  minRepMs: number;
  /** Gaps longer than this never count toward a plank hold. */
  maxFrameGapMs: number;
}

export const DEFAULT_CONFIG: CounterConfig = {
  minVisibility: 0.5,
  confirmFrames: 3,
  smoothing: 0.5,
  minRepMs: 500,
  maxFrameGapMs: 1000,
};

// MediaPipe pose landmark indices: [left, right]
const IDX = {
  shoulder: [11, 12],
  elbow: [13, 14],
  wrist: [15, 16],
  hip: [23, 24],
  knee: [25, 26],
  ankle: [27, 28],
} as const;
type Part = keyof typeof IDX;

const NEEDED: Record<Exercise, Part[]> = {
  pushup: ['shoulder', 'elbow', 'wrist', 'hip', 'ankle'],
  squat: ['shoulder', 'hip', 'knee', 'ankle'],
  plank: ['shoulder', 'elbow', 'hip', 'ankle'],
};

// Two thresholds per movement give hysteresis: a rep needs the full range between them.
const RANGE = {
  pushup: { down: 100, up: 150, partial: 130 },
  squat: { down: 105, up: 160, partial: 140 },
} as const;

const PUSHUP_MAX_TILT = 40;
const PUSHUP_MIN_BODY_LINE = 150;
const SQUAT_MIN_TORSO_TILT = 30;
const PLANK_MAX_TILT = 35;
const PLANK_MIN_BODY_LINE = 155;

export interface Counter {
  /** Feed one frame. `joints` is null when no person was detected. `t` is a timestamp in ms. */
  push(t: number, joints: Joint[] | null): CounterState;
  readonly state: CounterState;
}

export function createCounter(exercise: Exercise, config: Partial<CounterConfig> = {}): Counter {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const state: CounterState = {
    reps: 0,
    holdMs: 0,
    phase: 'idle',
    hint: 'noPerson',
    angle: null,
    tracking: false,
    side: null,
  };
  let good = 0;
  let bad = 0;
  let smoothed: number | null = null;
  let downAt = 0;
  let lowest = 180;
  let lastGoodPlankT: number | null = null;

  function loseTracking(hint: Hint) {
    state.tracking = false;
    state.hint = hint;
    state.angle = null;
    smoothed = null;
    lastGoodPlankT = null;
    // A half-finished rep is dropped rather than guessed.
    if (state.phase === 'down') state.phase = 'idle';
  }

  function pickSide(joints: Joint[]): 0 | 1 {
    let left = 0;
    let right = 0;
    for (const part of NEEDED[exercise]) {
      left += joints[IDX[part][0]]?.v ?? 0;
      right += joints[IDX[part][1]]?.v ?? 0;
    }
    return left >= right ? 0 : 1;
  }

  function push(t: number, joints: Joint[] | null): CounterState {
    if (!joints) {
      good = 0;
      bad++;
      if (bad >= cfg.confirmFrames || !state.tracking) loseTracking('noPerson');
      return state;
    }
    const s = pickSide(joints);
    const j = (part: Part) => joints[IDX[part][s]];
    const visible = NEEDED[exercise].every((part) => (j(part)?.v ?? 0) >= cfg.minVisibility);
    if (!visible) {
      good = 0;
      bad++;
      if (bad >= cfg.confirmFrames || !state.tracking) loseTracking('stepBack');
      return state;
    }
    bad = 0;
    good++;
    if (!state.tracking) {
      if (good < cfg.confirmFrames) return state;
      state.tracking = true;
    }
    state.side = s === 0 ? 'left' : 'right';
    state.hint = null;

    if (exercise === 'plank') return pushPlank(t, j);

    const raw =
      exercise === 'pushup'
        ? angleAt(j('shoulder'), j('elbow'), j('wrist'))
        : angleAt(j('hip'), j('knee'), j('ankle'));
    smoothed = smoothed === null ? raw : smoothed + cfg.smoothing * (raw - smoothed);
    state.angle = smoothed;

    const inPosition =
      exercise === 'pushup'
        ? tiltFromHorizontal(j('shoulder'), j('ankle')) <= PUSHUP_MAX_TILT
        : tiltFromHorizontal(j('shoulder'), j('hip')) >= SQUAT_MIN_TORSO_TILT;
    if (!inPosition) {
      state.phase = 'idle';
      state.hint = 'getIntoPosition';
      lowest = 180;
      return state;
    }

    const range = RANGE[exercise];
    const angle = smoothed;
    if (state.phase === 'idle') {
      if (angle >= range.up) {
        state.phase = 'up';
        lowest = 180;
      }
    } else if (state.phase === 'up') {
      lowest = Math.min(lowest, angle);
      if (angle <= range.down) {
        state.phase = 'down';
        downAt = t;
      } else if (angle >= range.up && lowest < range.partial) {
        // Came back up without reaching depth: not a rep.
        state.hint = 'goLower';
        lowest = 180;
      }
    } else if (angle >= range.up) {
      if (t - downAt >= cfg.minRepMs / 2) state.reps++;
      state.phase = 'up';
      lowest = 180;
    }

    if (
      exercise === 'pushup' &&
      state.hint === null &&
      angleAt(j('shoulder'), j('hip'), j('ankle')) < PUSHUP_MIN_BODY_LINE
    ) {
      state.hint = 'hipsInLine';
    }
    return state;
  }

  function pushPlank(t: number, j: (part: Part) => Joint): CounterState {
    const line = angleAt(j('shoulder'), j('hip'), j('ankle'));
    state.angle = line;
    const formOk =
      line >= PLANK_MIN_BODY_LINE && tiltFromHorizontal(j('shoulder'), j('ankle')) <= PLANK_MAX_TILT;
    if (!formOk) {
      state.phase = 'idle';
      state.hint = 'straighten';
      lastGoodPlankT = null;
      return state;
    }
    state.phase = 'up';
    if (lastGoodPlankT !== null) {
      const dt = t - lastGoodPlankT;
      // Clock math only: a backwards or stalled clock adds nothing.
      if (dt > 0 && dt <= cfg.maxFrameGapMs) state.holdMs += dt;
    }
    lastGoodPlankT = t;
    return state;
  }

  return { push, state };
}
