export type Point = { x: number; y: number };
export const ORIGIN = { lat: 38.98622, lng: -76.94288 };
// Candidate campus extent and outdoor anchors. These are not university-approved boundaries.
export type Arena = {
  version: 2;
  boundary: Point[];
  exclusions: { center: Point; radius: number }[];
};
export const MALL_FINALS: Point[] = [
  { x: -75, y: 0 },
  { x: 75, y: 0 },
];
export const CAMPUS_BOUNDARY = [
  [39.0034, -76.9518],
  [39.0034, -76.9379],
  [38.9951, -76.9357],
  [38.9894, -76.936],
  [38.9844, -76.9368],
  [38.9798, -76.9391],
  [38.9798, -76.9473],
  [38.9848, -76.9518],
  [38.991, -76.956],
].map(([lat, lng]) => fromLngLat(lat, lng));
export const LANDMARKS = [
  { name: "McKeldin Mall · west lawn", lat: 38.9861, lng: -76.94405 },
  { name: "McKeldin Mall · east lawn", lat: 38.98655, lng: -76.94172 },
  { name: "Chapel lawn", lat: 38.98421, lng: -76.94043 },
  { name: "Hornbake Plaza", lat: 38.98802, lng: -76.9407 },
  { name: "Engineering quad", lat: 38.98938, lng: -76.93775 },
  { name: "La Plata Beach", lat: 38.99298, lng: -76.946 },
  { name: "Clarice lawn", lat: 38.9901, lng: -76.94995 },
  { name: "South Campus lawn", lat: 38.98195, lng: -76.94355 },
  { name: "Xfinity · south outdoor plaza", lat: 38.99895, lng: -76.94142 },
].map((p) => ({ ...p, ...fromLngLat(p.lat, p.lng) }));
export const FINALS: Point[] = LANDMARKS.map(({ x, y }) => ({ x, y }));
export const CAMPUS_ARENA: Arena = {
  version: 2,
  boundary: CAMPUS_BOUNDARY,
  exclusions: [{ center: { x: 0, y: 0 }, radius: 18 }],
};
export function pointInPolygon(p: Point, polygon: Point[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      result = !result;
  }
  return result;
}
export function insideLegacy(p: Point) {
  return (
    Math.abs(p.x) <= 140 && Math.abs(p.y) <= 30 && Math.hypot(p.x, p.y) > 18
  );
}
export function inPlayArea(m: { arena?: Arena }, p: Point) {
  return m.arena ? inside(p, m.arena) : insideLegacy(p);
}
export const distance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y);
export function inside(p: Point, arena: Arena = CAMPUS_ARENA) {
  return (
    pointInPolygon(p, arena.boundary) &&
    arena.exclusions.every((e) => distance(p, e.center) > e.radius)
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
