export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}
