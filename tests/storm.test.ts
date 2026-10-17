import test from "node:test";
import assert from "node:assert/strict";
import { generateStorm, RADII } from "../lib/storm";
import { CAMPUS_ARENA, LANDMARKS, distance, inside } from "../lib/geo";
import { createMatch, view, zone, apply } from "../lib/engine";
function seeded(seed: number) {
  return () => {
    seed += 0x6d2b79f5;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
test("1,000 campus storm paths start 1.8 km wide, mix close/far pulls and always nest", () => {
  const openings = new Set<string>(),
    finals = new Set<string>();
  for (let seed = 1; seed <= 1000; seed++) {
    const path = generateStorm(seeded(seed));
    assert.deepEqual(
      path.map((c) => c.radius),
      [900, 650, 420, 250, 120, 45],
    );
    assert.equal(path.filter((c) => c.pull === "far").length, 3);
    assert.equal(path.filter((c) => c.pull === "close").length, 2);
    for (let i = 0; i < path.length; i++) {
      assert.ok(inside(path[i].center, CAMPUS_ARENA));
      if (i) {
        const moved = distance(path[i].center, path[i - 1].center),
          gap = path[i - 1].radius - path[i].radius;
        assert.ok(moved + path[i].radius <= path[i - 1].radius + 1e-8);
        assert.ok(
          path[i].pull === "far" ? moved >= gap * 0.74 : moved <= gap * 0.31,
        );
      }
    }
    assert.ok(LANDMARKS.some((p) => distance(p, path[5].center) < 1e-6));
    for (let i = 0; i < 32; i++) {
      const theta = (i / 32) * Math.PI * 2;
      assert.ok(
        inside(
          {
            x: path[5].center.x + 45 * Math.cos(theta),
            y: path[5].center.y + 45 * Math.sin(theta),
          },
          CAMPUS_ARENA,
        ),
        "final circle lies within candidate outdoor extent",
      );
    }
    openings.add(
      `${Math.round(path[0].center.x)},${Math.round(path[0].center.y)}`,
    );
    finals.add(`${path[5].center.x},${path[5].center.y}`);
  }
  assert.ok(openings.size > 900);
  assert.equal(finals.size, LANDMARKS.length);
});
test("future storm path and final remain server-private; only the next circle appears at 3:00", () => {
  const now = 1700000000000,
    m = createMatch("STORMABC", "host", "Host", now, seeded(1));
  m.status = "active";
  m.start = now;
  assert.equal(zone(m, now).radius, RADII[0]);
  const before = view(m, "host", now + 179000),
    after = view(m, "host", now + 180000);
  assert.ok(!("zones" in before));
  assert.ok(!("final" in before));
  assert.equal(before.zone.next, null);
  assert.deepEqual(after.zone.next, m.zones![1]);
  assert.equal(view(m, "host", now + 300000).zone.next, null);
});
test("a campus lobby opening is fixed while readying, and supplies are distributed within it", () => {
  const now = 1700000000000,
    m = createMatch("STORMABC", "host", "Host", now, seeded(31));
  const original = structuredClone(m.zones);
  for (let i = 1; i < 8; i++) apply(m, `p${i}`, { type: "join" }, now);
  m.players.forEach((p) => {
    p.fix = { ...m.zones![0].center, accuracy: 8, at: now };
    p.ready = true;
  });
  apply(m, "host", { type: "start", approved: true }, now, seeded(12));
  assert.deepEqual(m.zones, original);
  assert.ok(m.pickups.length >= 4);
  assert.ok(m.pickups.some((p) => p.kind === "life"));
  assert.ok(m.pickups.some((p) => p.kind === "med"));
  assert.ok(
    m.pickups.every(
      (p) => inside(p, m.arena) && distance(p, m.zones![0].center) <= 900,
    ),
  );
});
