import { describe, expect, it } from 'vitest';
import { createCounter, type Exercise, type Hint } from '../src/pose/counter';
import { angleAt, tiltFromHorizontal, toPixels, type Joint } from '../src/pose/geometry';
import { plankPose, pushupPose, repAngles, squatPose } from './skeleton';

const FRAME_MS = 1000 / 15;

function run(exercise: Exercise, frames: (Joint[] | null)[], frameMs = FRAME_MS) {
  const counter = createCounter(exercise);
  const hints = new Set<Hint>();
  frames.forEach((joints, i) => hints.add(counter.push(i * frameMs, joints).hint));
  return { ...counter.state, hints };
}

describe('geometry', () => {
  it('measures a right angle and a straight line', () => {
    const p = (x: number, y: number): Joint => ({ x, y, v: 1 });
    expect(angleAt(p(0, 1), p(0, 0), p(1, 0))).toBeCloseTo(90);
    expect(angleAt(p(-1, 0), p(0, 0), p(1, 0))).toBeCloseTo(180);
    expect(tiltFromHorizontal(p(0, 0), p(1, 1))).toBeCloseTo(45);
  });

  it('scales by frame size so a wide frame does not distort angles', () => {
    // Square corner in pixels, expressed in 0..1 coordinates of a 640x480 frame.
    const joints = toPixels(
      [
        { x: 100 / 640, y: 200 / 480, visibility: 1 },
        { x: 100 / 640, y: 100 / 480, visibility: 1 },
        { x: 200 / 640, y: 100 / 480, visibility: 1 },
      ],
      640,
      480,
    );
    expect(angleAt(joints[0], joints[1], joints[2])).toBeCloseTo(90);
  });

  it('gives the same angle for a mirrored pose (mirror is display only)', () => {
    const pose = pushupPose(120);
    const mirrored = pose.map((j) => ({ ...j, x: 640 - j.x }));
    expect(angleAt(mirrored[11], mirrored[13], mirrored[15])).toBeCloseTo(angleAt(pose[11], pose[13], pose[15]));
  });
});

describe('push-ups', () => {
  it('counts 10 good reps exactly', () => {
    const frames = repAngles(10, 165, 80).map((a) => pushupPose(a));
    expect(run('pushup', frames).reps).toBe(10);
  });

  it('counts 10 good reps with jittery landmarks', () => {
    const frames = repAngles(10, 165, 80).map((a, i) => pushupPose(a, { noise: 6, seed: i + 1 }));
    expect(run('pushup', frames).reps).toBe(10);
  });

  it('counts fast and slow reps', () => {
    expect(run('pushup', repAngles(8, 165, 80, 1).map((a) => pushupPose(a))).reps).toBe(8);
    expect(run('pushup', repAngles(5, 165, 80, 5).map((a) => pushupPose(a))).reps).toBe(5);
  });

  it('does not count sloppy half reps and asks to go lower', () => {
    const frames = repAngles(6, 165, 118).map((a) => pushupPose(a));
    const result = run('pushup', frames);
    expect(result.reps).toBe(0);
    expect(result.hints.has('goLower')).toBe(true);
  });

  it('counts only the full reps in a mixed set', () => {
    const frames = [
      ...repAngles(4, 165, 80),
      ...repAngles(3, 165, 118),
      ...repAngles(3, 165, 85),
    ].map((a) => pushupPose(a));
    expect(run('pushup', frames).reps).toBe(7);
  });

  it('does not double count when the angle wobbles at a threshold', () => {
    const wobble = Array.from({ length: 40 }, (_, i) => (i % 2 ? 97 : 103));
    const frames = [...repAngles(1, 165, 80), ...Array(8).fill(165), ...wobble, ...Array(8).fill(165)].map(
      (a: number) => pushupPose(a),
    );
    expect(run('pushup', frames).reps).toBe(2);
  });

  it('counts nothing with only part of the body in view', () => {
    const frames = repAngles(10, 165, 80).map((a) => pushupPose(a, { hideAnkles: true }));
    const result = run('pushup', frames);
    expect(result.reps).toBe(0);
    expect(result.hints.has('stepBack')).toBe(true);
  });

  it('ignores arm bending while standing upright', () => {
    const frames = repAngles(5, 165, 80).map((a) => {
      const pose = squatPose(175);
      // Standing, bending the elbow: swap in an arm with the requested angle.
      const arm = pushupPose(a);
      const dx = pose[11].x - arm[11].x;
      const dy = pose[11].y - arm[11].y;
      for (const i of [13, 15]) pose[i] = { x: arm[i].x + dx, y: arm[i].y + dy, v: 0.95 };
      return pose;
    });
    const result = run('pushup', frames);
    expect(result.reps).toBe(0);
    expect(result.hints.has('getIntoPosition')).toBe(true);
  });

  it('warns about sagging hips but still counts', () => {
    const frames = repAngles(3, 165, 80).map((a) => pushupPose(a, { hipSag: 60 }));
    const result = run('pushup', frames);
    expect(result.reps).toBe(3);
    expect(result.hints.has('hipsInLine')).toBe(true);
  });

  it('survives the person leaving mid-set without inventing reps', () => {
    const before = repAngles(3, 165, 80).map((a) => pushupPose(a));
    const halfDown = [165, 150, 130, 110, 90].map((a) => pushupPose(a));
    const gone: null[] = Array(20).fill(null);
    const after = repAngles(2, 165, 80).map((a) => pushupPose(a));
    const result = run('pushup', [...before, ...halfDown, ...gone, ...after]);
    expect(result.reps).toBe(5);
    expect(result.hints.has('noPerson')).toBe(true);
  });
});

describe('squats', () => {
  it('counts 12 good reps, clean and jittery', () => {
    expect(run('squat', repAngles(12, 172, 85).map((a) => squatPose(a))).reps).toBe(12);
    expect(run('squat', repAngles(12, 172, 85).map((a, i) => squatPose(a, { noise: 6, seed: i + 3 }))).reps).toBe(12);
  });

  it('does not count shallow squats', () => {
    const result = run('squat', repAngles(5, 172, 125).map((a) => squatPose(a)));
    expect(result.reps).toBe(0);
    expect(result.hints.has('goLower')).toBe(true);
  });

  it('counts nothing when the feet are out of frame', () => {
    const result = run('squat', repAngles(5, 172, 85).map((a) => squatPose(a, { hideAnkles: true })));
    expect(result.reps).toBe(0);
    expect(result.hints.has('stepBack')).toBe(true);
  });
});

describe('plank', () => {
  it('times a 30 second hold from timestamps', () => {
    const frames = Array.from({ length: 30 * 15 + 3 }, () => plankPose());
    const result = run('plank', frames);
    expect(result.holdMs / 1000).toBeGreaterThan(29.5);
    expect(result.holdMs / 1000).toBeLessThan(30.5);
  });

  it('gives the same time at a lower frame rate (clock math, not tick counts)', () => {
    const frames = Array.from({ length: 30 * 5 + 3 }, () => plankPose());
    const result = run('plank', frames, 200);
    expect(result.holdMs / 1000).toBeGreaterThan(29.5);
    expect(result.holdMs / 1000).toBeLessThan(30.5);
  });

  it('pauses during a form break', () => {
    const good = (n: number) => Array.from({ length: n }, () => plankPose());
    const sag = Array.from({ length: 5 * 15 }, () => plankPose(70));
    const result = run('plank', [...good(10 * 15), ...sag, ...good(10 * 15)]);
    expect(result.holdMs / 1000).toBeGreaterThan(19);
    expect(result.holdMs / 1000).toBeLessThan(20.5);
    expect(result.hints.has('straighten')).toBe(true);
  });

  it('never counts a long gap or a clock that goes backwards', () => {
    const counter = createCounter('plank');
    [0, 70, 140, 210].forEach((t) => counter.push(t, plankPose()));
    const base = counter.state.holdMs;
    counter.push(60_000, plankPose());
    expect(counter.state.holdMs).toBe(base);
    counter.push(1_000, plankPose());
    expect(counter.state.holdMs).toBe(base);
  });

  it('does not count standing as a plank', () => {
    const frames = Array.from({ length: 60 }, () => squatPose(175));
    expect(run('plank', frames).holdMs).toBe(0);
  });
});
