/** A joint in pixel space (already scaled by frame width/height) with its visibility 0..1. */
export interface Joint {
  x: number;
  y: number;
  v: number;
}

/** Angle in degrees at joint b, between the segments b->a and b->c. */
export function angleAt(a: Joint, b: Joint, c: Joint): number {
  const ax = a.x - b.x;
  const ay = a.y - b.y;
  const cx = c.x - b.x;
  const cy = c.y - b.y;
  const mag = Math.hypot(ax, ay) * Math.hypot(cx, cy);
  if (mag === 0) return 180;
  const cos = Math.min(1, Math.max(-1, (ax * cx + ay * cy) / mag));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** How far the line a-b tilts away from horizontal, 0 (flat) to 90 (upright). */
export function tiltFromHorizontal(a: Joint, b: Joint): number {
  const deg = (Math.atan2(Math.abs(a.y - b.y), Math.abs(a.x - b.x)) * 180) / Math.PI;
  return deg;
}

export interface NormalizedLandmark {
  x: number;
  y: number;
  visibility?: number;
}

/**
 * MediaPipe gives 0..1 coordinates. Angles must be measured in pixels, otherwise a
 * non-square frame stretches them. Mirroring is a display concern and never applied here.
 */
export function toPixels(landmarks: NormalizedLandmark[], width: number, height: number): Joint[] {
  return landmarks.map((p) => ({ x: p.x * width, y: p.y * height, v: p.visibility ?? 0 }));
}
