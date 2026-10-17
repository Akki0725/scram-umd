export type Point = { x: number; y: number };
export const ORIGIN = { lat: 38.98622, lng: -76.94288 };
// Candidate Mall footprint only. Organizer must inspect and approve before real play.
export const FINALS: Point[] = [
  { x: -75, y: 0 },
  { x: 75, y: 0 },
];
export const distance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y);
export function inside(p: Point) {
  return (
    Math.abs(p.x) <= 140 && Math.abs(p.y) <= 30 && Math.hypot(p.x, p.y) > 18
  );
}
export function toLngLat(p: Point): [number, number] {
  const t = Math.PI / 18;
  const east = p.x * Math.cos(t) - p.y * Math.sin(t),
    north = p.x * Math.sin(t) + p.y * Math.cos(t);
  return [
    ORIGIN.lng + east / (111320 * Math.cos((ORIGIN.lat * Math.PI) / 180)),
    ORIGIN.lat + north / 111320,
  ];
}
export function fromLngLat(lat: number, lng: number): Point {
  const east =
      (lng - ORIGIN.lng) * 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180),
    north = (lat - ORIGIN.lat) * 111320,
    t = Math.PI / 18;
  return {
    x: east * Math.cos(t) + north * Math.sin(t),
    y: -east * Math.sin(t) + north * Math.cos(t),
  };
}
export function circle(center: Point, r: number) {
  return Array.from({ length: 97 }, (_, i) =>
    toLngLat({
      x: center.x + Math.cos((i / 96) * 2 * Math.PI) * r,
      y: center.y + Math.sin((i / 96) * 2 * Math.PI) * r,
    }),
  );
}
