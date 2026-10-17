import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { apply, createMatch, tick, type Match } from "../lib/engine";
const NOW = 1700000000000;
function fixture(count: number, seconds: number) {
  const m = createMatch("CLOCKABC", "p0", "Player 0", NOW);
  delete m.zones;
  delete m.arena;
  m.final = { x: -75, y: 0 };
  for (let i = 1; i < count; i++)
    apply(m, `p${i}`, { type: "join", name: `Player ${i}` }, NOW);
  m.players.forEach((p, i) => {
    p.ready = true;
    p.fix = { x: i % 2 ? -75 : 75, y: 0, accuracy: 8, at: NOW };
  });
  apply(m, "p0", { type: "start", approved: true }, NOW, () => 0.5);
  m.tick = seconds;
  return m;
}
test("hosted SQL clock matches TypeScript authority across phases, grid signs, revivals, disconnections and wins", async () => {
  const pg = new PGlite();
  try {
    const sql = await readFile(
      new URL("../supabase/migrations/002_database_clock.sql", import.meta.url),
      "utf8",
    );
    await pg.exec(
      "create role anon;create role authenticated;create role service_role;",
    );
    await pg.exec(sql.split("-- Scheduling is separate")[0]);
    await pg.exec(
      await readFile(
        new URL("../supabase/migrations/003_campus_storm.sql", import.meta.url),
        "utf8",
      ),
    );
    const cases: { m: Match; at: number }[] = [];
    for (const seconds of [0, 119, 299, 599, 899, 1199, 1499, 2399]) {
      const m = createMatch("NEWCAMPUS", "you", "Player", NOW, () => 0.47);
      for (let i = 1; i < 8; i++) apply(m, `p${i}`, { type: "join" }, NOW);
      m.players.forEach((p) => {
        p.ready = true;
        p.fix = { ...m.zones![0].center, at: NOW, accuracy: 8 };
      });
      apply(m, "you", { type: "start", approved: true }, NOW, () => 0.5);
      m.tick = seconds;
      m.players.forEach((p, i) => {
        p.hp = i % 2 ? 2 : 100;
        p.life = i % 3 === 0;
        p.fix = {
          ...m.zones![Math.min(5, Math.floor((seconds + 1) / 300))].center,
          at: NOW + (seconds + 1) * 1000,
          accuracy: 8,
        };
        if (i % 2 === 0) p.fix.x = 9000;
      });
      cases.push({ m, at: NOW + (seconds + 1) * 1000 });
    }
    for (const seconds of [0, 119, 179, 299, 599, 899, 1199, 1499, 2399])
      for (const count of [3, 8, 20]) {
        const m = fixture(count, seconds);
        m.players.forEach((p, i) => {
          p.hp = i % 2 ? 2 : 30;
          p.life = i % 3 === 0;
          p.fix = {
            x: [-100, -60, -20, 20, 60, 100][i % 6],
            y: i % 4 === 0 ? 80 : 0,
            accuracy: 8,
            at: NOW + (seconds + 1) * 1000,
          };
        });
        cases.push({ m, at: NOW + (seconds + 1) * 1000 });
      }
    cases.push({ m: fixture(8, 0), at: NOW + 170000 });
    const revive = fixture(8, 300);
    revive.players.forEach((p) => {
      p.life = true;
      p.hp = 2;
      p.fix = { x: 999, y: 999, accuracy: 8, at: NOW + 305000 };
    });
    cases.push({ m: revive, at: NOW + 305000 });
    const idle = fixture(8, 180);
    idle.status = "lobby";
    cases.push({ m: idle, at: NOW + 190000 });
    for (const { m, at } of cases) {
      const expected = structuredClone(m);
      tick(expected, at);
      const actual = await pg.query<{ m: Match }>(
        "select public.scram_tick($1::jsonb,$2::bigint) as m",
        [JSON.stringify(m), at],
      );
      assert.deepEqual(
        actual.rows[0].m,
        JSON.parse(JSON.stringify(expected)),
        `phase tick=${m.tick}, players=${m.players.length}`,
      );
    }
  } finally {
    await pg.close();
  }
});
