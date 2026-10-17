import test from "node:test";
import assert from "node:assert/strict";
import { apply, createMatch, tick, view, zone, HEADSTART } from "../lib/engine";
import { FINALS, inside, distance, fromLngLat, toLngLat } from "../lib/geo";
const NOW = 1700000000000;
function setup(n = 8) {
  const m = createMatch("TESTABCD", "p0", "Player 0", NOW);
  for (let i = 1; i < n; i++)
    apply(m, `p${i}`, { type: "join", name: `Player ${i}` }, NOW);
  m.players.forEach((p) => {
    p.ready = true;
    p.fix = { x: -75, y: 0, accuracy: 8, at: NOW };
  });
  apply(m, "p0", { type: "start", approved: true }, NOW, () => 0.5);
  return m;
}
test("full lobby capacity, round-up team allocation at every size", () => {
  for (let n = 3; n <= 20; n++) {
    const m = setup(n);
    assert.equal(
      m.players.filter((p) => p.role === "hunter").length,
      Math.ceil(n / 4),
    );
    assert.equal(
      m.players.filter((p) => p.role === "runner").length,
      n - Math.ceil(n / 4),
    );
  }
  const m = createMatch("TESTABCD", "p0", "P0", NOW);
  for (let i = 1; i < 20; i++) apply(m, `p${i}`, { type: "join" }, NOW);
  assert.throws(() => apply(m, "p20", { type: "join" }, NOW), /full/);
});
test("starting requires host, consent, readiness, fresh location and minimum players", () => {
  const m = createMatch("TESTABCD", "p0", "P0", NOW);
  assert.throws(
    () => apply(m, "p0", { type: "start", approved: true }, NOW),
    /At least/,
  );
  const s = setup();
  s.status = "lobby";
  assert.throws(
    () => apply(s, "p1", { type: "start", approved: true }, NOW),
    /host/,
  );
  assert.throws(() => apply(s, "p0", { type: "start" }, NOW), /Approve/);
  s.players[1].ready = false;
  assert.throws(
    () => apply(s, "p0", { type: "start", approved: true }, NOW),
    /Everyone/,
  );
});
test("headstart blocks tags, physical tag converts runner and ignores extra life", () => {
  const m = setup(),
    runner = m.players.find((p) => p.role === "runner")!;
  assert.throws(
    () => apply(m, runner.id, { type: "tag" }, NOW + 1000),
    /not been released/,
  );
  m.tick = HEADSTART;
  runner.life = true;
  apply(m, runner.id, { type: "tag" }, NOW + HEADSTART * 1000);
  assert.equal(runner.role, "hunter");
});
test("privacy: no exact opponent coordinates, no pre-release ping, no future final zone", () => {
  const m = setup();
  const hunter = m.players.find((p) => p.role === "hunter")!;
  const v = view(m, hunter.id, NOW);
  assert.equal(v.pings.length, 0);
  assert.ok(!("final" in v));
  assert.equal(v.zone.next, null);
  for (const p of v.players.filter((p) => p.id !== hunter.id)) {
    assert.ok(!("fix" in p));
    assert.ok(!("previousFix" in p));
    assert.equal(p.hp, undefined);
  }
  assert.throws(() => view(m, "outsider", NOW), /not in/);
});
test("all remaining runners are quantized and frozen between 60 second snapshots", () => {
  const m = setup();
  m.players.forEach((p) => {
    p.fix!.at = NOW + 120000;
    p.fix!.x = -73;
  });
  m.tick = 119;
  tick(m, NOW + 120000);
  assert.equal(
    m.pings.length,
    m.players.filter((p) => p.role === "runner").length,
  );
  assert.ok(m.pings.every((p) => p.x % 40 === 0 && p.y % 40 === 0));
  const frozen = JSON.stringify(m.pings);
  m.players.forEach((p) => {
    p.fix!.x = -20;
    p.fix!.at = NOW + 150000;
  });
  tick(m, NOW + 150000);
  assert.equal(JSON.stringify(m.pings), frozen);
  const r = m.players.find((p) => p.role === "runner")!;
  assert.equal(view(m, r.id, NOW + 150000).pings.length, 0);
});
test("storm DPS escalates, tick catchup is idempotent, extra life is consumed once", () => {
  assert.deepEqual(
    [0, 300, 600, 900, 1200, 1500].map(
      (s) => zone(setup(), NOW + s * 1000).damage,
    ),
    [1, 2, 5, 8, 10, 10],
  );
  const m = setup();
  m.players.forEach((p) => {
    p.fix!.x = -100;
    p.fix!.at = NOW + 310000;
  });
  m.tick = 300;
  const r = m.players.find((p) => p.role === "runner")!;
  r.fix!.y = 80;
  r.hp = 20;
  tick(m, NOW + 305000);
  assert.equal(r.hp, 10);
  tick(m, NOW + 305000);
  assert.equal(r.hp, 10);
  r.life = true;
  tick(m, NOW + 310000);
  assert.equal(r.hp, 100);
  assert.equal(r.life, false);
  assert.equal(r.role, "runner");
});
test("pickup claim validates dwell, accuracy, distance, ownership and health ceiling", () => {
  const m = setup();
  m.tick = 180;
  const r = m.players.find((p) => p.role === "runner")!,
    item = m.pickups[0];
  r.hp = 90;
  assert.throws(
    () => apply(m, r.id, { type: "claim", pickupId: item.id }, NOW + 180000),
    /Stand/,
  );
  r.fix = { ...item, at: NOW + 180000, accuracy: 8 };
  r.previousFix = { ...item, at: NOW + 170000, accuracy: 8 };
  apply(m, r.id, { type: "claim", pickupId: item.id }, NOW + 180000);
  assert.equal(r.hp, 100);
  assert.equal(item.claimed, r.id);
  assert.throws(
    () => apply(m, r.id, { type: "claim", pickupId: item.id }, NOW + 180000),
    /already/,
  );
});
test("GPS rejects stale, inaccurate, too frequent and implausibly fast movement", () => {
  const m = setup();
  assert.throws(
    () =>
      apply(
        m,
        "p0",
        { type: "location", fix: { x: 0, y: 0, at: NOW - 20000, accuracy: 8 } },
        NOW,
      ),
    /fresh/,
  );
  assert.throws(
    () =>
      apply(
        m,
        "p0",
        { type: "location", fix: { x: 0, y: 0, at: NOW, accuracy: 100 } },
        NOW,
      ),
    /fresh/,
  );
  assert.throws(
    () =>
      apply(
        m,
        "p0",
        {
          type: "location",
          fix: { x: -75, y: 0, at: NOW + 1000, accuracy: 8 },
        },
        NOW + 1000,
      ),
    /frequent/,
  );
  assert.throws(
    () =>
      apply(
        m,
        "p0",
        {
          type: "location",
          fix: { x: 999, y: 0, at: NOW + 10000, accuracy: 8 },
        },
        NOW + 10000,
      ),
    /jumped/,
  );
});
test("disconnects do not pause damage and finished games purge coordinates", () => {
  const m = setup();
  tick(m, NOW + 150000);
  assert.equal(m.status, "finished");
  assert.equal(m.winner, undefined);
  assert.equal(m.pings.length, 0);
  for (const p of m.players) {
    assert.equal(p.fix, undefined);
    assert.equal(p.previousFix, undefined);
  }
});
test("last tagged runner leaves one winner and revokes location disclosure", () => {
  const m = setup(4);
  m.tick = 120;
  const runners = m.players.filter((p) => p.role === "runner");
  apply(m, runners[0].id, { type: "tag" }, NOW + 120000);
  apply(m, runners[1].id, { type: "tag" }, NOW + 120000);
  assert.equal(m.winner, runners[2].id);
  assert.equal(m.status, "finished");
  assert.ok(m.players.every((p) => !p.fix));
});
test("leave removes participation, transfers host and denies later reads", () => {
  const m = setup();
  m.tick = 120;
  apply(m, "p0", { type: "leave" }, NOW + 120000);
  assert.ok(!m.players.some((p) => p.id === "p0"));
  assert.notEqual(m.host, "p0");
  assert.throws(() => view(m, "p0", NOW), /not in/);
});
test("every future circle nests in previous circle and final avoids exclusion", () => {
  for (const final of FINALS) {
    const m = setup();
    m.final = final;
    for (let i = 0; i < 5; i++) {
      const a = zone(m, NOW + i * 300000),
        b = zone(m, NOW + (i + 1) * 300000);
      assert.ok(distance(a.center, b.center) + b.radius <= a.radius + 0.001);
    }
    assert.ok(inside(final));
    assert.ok(distance(final, { x: 0, y: 0 }) - 22 > 18);
  }
});
test("geographic projection round trips without coordinate drift", () => {
  for (const p of [
    { x: 0, y: 0 },
    { x: 140, y: 30 },
    { x: -100, y: -12 },
  ]) {
    const [lng, lat] = toLngLat(p),
      r = fromLngLat(lat, lng);
    assert.ok(distance(p, r) < 1e-6);
  }
});
test("40 minute cap gives a draw rather than an arbitrary winner", () => {
  const m = setup();
  m.tick = 2399;
  m.players.forEach((p) => {
    p.fix = { ...m.final, at: NOW + 2400000, accuracy: 8 };
  });
  tick(m, NOW + 2400000);
  assert.equal(m.status, "finished");
  assert.equal(m.reason, "Time limit · match drawn");
  assert.equal(m.winner, undefined);
});
