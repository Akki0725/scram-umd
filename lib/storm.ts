import { CAMPUS_ARENA, LANDMARKS, distance, inside, type Point } from "./geo";
export const RADII = [900, 650, 420, 250, 120, 45] as const;
export type StormCircle = {
  center: Point;
  radius: number;
  pull: "opening" | "close" | "far";
};
// Build backwards from an outdoor candidate so every transition is nested, with no fixed center.
export function generateStorm(random = Math.random): StormCircle[] {
  const anchor =
    LANDMARKS[
      Math.min(LANDMARKS.length - 1, Math.floor(random() * LANDMARKS.length))
    ];
  const result: StormCircle[] = RADII.map((radius) => ({
    center: { x: anchor.x, y: anchor.y },
    radius,
    pull: "opening",
  }));
  const kinds: ("close" | "far")[] = ["close", "close", "far", "far", "far"];
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  for (let i = RADII.length - 2; i >= 0; i--) {
    const next = result[i + 1],
      gap = RADII[i] - next.radius,
      kind = kinds[i];
    let chosen = next.center;
    // Random angle, then rotating alternatives ensure deterministic RNGs cannot trap edge anchors.
    const base = random() * Math.PI * 2,
      amount =
        gap *
        (kind === "far" ? 0.75 + random() * 0.22 : 0.08 + random() * 0.22);
    for (let attempt = 0; attempt < 64; attempt++) {
      const angle = base + attempt * 2.399963;
      const p = {
        x: next.center.x + Math.cos(angle) * amount,
        y: next.center.y + Math.sin(angle) * amount,
      };
      if (inside(p, CAMPUS_ARENA)) {
        chosen = p;
        break;
      }
    }
    result[i] = { center: { ...chosen }, radius: RADII[i], pull: "opening" };
  }
  result.forEach((c, i) => {
    if (i)
      c.pull =
        distance(c.center, result[i - 1].center) >
        (result[i - 1].radius - c.radius) * 0.5
          ? "far"
          : "close";
  });
  return result;
}
export function nearestLandmark(p: Point) {
  return [...LANDMARKS].sort((a, b) => distance(a, p) - distance(b, p))[0].name;
}
