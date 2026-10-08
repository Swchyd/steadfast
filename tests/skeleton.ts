import type { Joint } from '../src/pose/geometry';

// Synthetic side-view skeletons in a 640x480 frame. These stand in for recorded landmark
// data until real recordings from the phone are added as fixtures.

const rad = (deg: number) => (deg * Math.PI) / 180;

function blank(): Joint[] {
  return Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 0 }));
}

function put(joints: Joint[], index: number, x: number, y: number, v = 0.95) {
  joints[index] = { x, y, v };
  // The far side of the body is hidden in a side view.
  joints[index + 1] = { x: x + 4, y: y + 2, v: 0.2 };
}

export interface Options {
  noise?: number;
  hideAnkles?: boolean;
  seed?: number;
}

function jitter(joints: Joint[], amount: number, seed: number) {
  let s = seed * 9301 + 49297;
  const next = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280 - 0.5;
  };
  for (const j of joints) {
    j.x += next() * amount;
    j.y += next() * amount;
  }
}

export function pushupPose(elbowDeg: number, opts: Options & { hipSag?: number } = {}): Joint[] {
  const joints = blank();
  const arm = 70;
  const reach = 2 * arm * Math.sin(rad(elbowDeg / 2));
  const shoulder = { x: 420, y: 400 - reach };
  const ankle = { x: 100, y: 400 };
  put(joints, 11, shoulder.x, shoulder.y);
  put(joints, 13, 420 - arm * Math.cos(rad(elbowDeg / 2)), 400 - reach / 2);
  put(joints, 15, 420, 400);
  put(joints, 23, (shoulder.x + ankle.x) / 2, (shoulder.y + ankle.y) / 2 + (opts.hipSag ?? 0));
  put(joints, 25, 180, (shoulder.y + ankle.y) / 2 + 30);
  put(joints, 27, ankle.x, ankle.y, opts.hideAnkles ? 0.1 : 0.95);
  if (opts.noise) jitter(joints, opts.noise, opts.seed ?? 1);
  return joints;
}

export function squatPose(kneeDeg: number, opts: Options = {}): Joint[] {
  const joints = blank();
  const a = rad((180 - kneeDeg) / 2);
  const leg = 100;
  const hipY = 420 - 2 * leg * Math.cos(a);
  put(joints, 27, 300, 420, opts.hideAnkles ? 0.1 : 0.95);
  put(joints, 25, 300 + leg * Math.sin(a), 420 - leg * Math.cos(a));
  put(joints, 23, 300, hipY);
  put(joints, 11, 310, hipY - 120);
  put(joints, 13, 320, hipY - 70);
  put(joints, 15, 340, hipY - 40);
  if (opts.noise) jitter(joints, opts.noise, opts.seed ?? 1);
  return joints;
}

export function plankPose(hipSag = 0, opts: Options = {}): Joint[] {
  const joints = blank();
  put(joints, 11, 420, 330);
  put(joints, 13, 420, 400);
  put(joints, 15, 470, 400);
  put(joints, 23, 260, 365 + hipSag);
  put(joints, 25, 180, 383);
  put(joints, 27, 100, 400, opts.hideAnkles ? 0.1 : 0.95);
  if (opts.noise) jitter(joints, opts.noise, opts.seed ?? 1);
  return joints;
}

/** Angle values for `reps` smooth repetitions between top and bottom, sampled at `fps`. */
export function repAngles(reps: number, top: number, bottom: number, secondsPerRep = 2, fps = 15): number[] {
  const out: number[] = [];
  const perRep = Math.round(secondsPerRep * fps);
  for (let i = 0; i < 8; i++) out.push(top);
  for (let r = 0; r < reps; r++) {
    for (let i = 0; i < perRep; i++) {
      const phase = (1 - Math.cos((2 * Math.PI * i) / perRep)) / 2;
      out.push(top - (top - bottom) * phase);
    }
  }
  for (let i = 0; i < 8; i++) out.push(top);
  return out;
}
