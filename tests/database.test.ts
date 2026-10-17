import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createMatch } from "../lib/engine";

test("embedded PostgreSQL executes migration, CAS, durable limits and membership RLS", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
    const sql = await readFile(
      new URL("../supabase/migrations/001_scram.sql", import.meta.url),
      "utf8",
    );
    // PGlite runs actual PostgreSQL but has no Supabase Realtime publication or pg_cron daemon.
    await pg.exec(
      sql
        .split("-- Privacy cleanup")[0]
        .replace(
          "alter publication supabase_realtime add table public.scram_signals;",
          "",
        ),
    );
    const uid = "11111111-1111-4111-8111-111111111111",
      other = "22222222-2222-4222-8222-222222222222";
    await pg.query("insert into auth.users(id) values($1),($2)", [uid, other]);
    const m = createMatch("TESTABCD", uid, "Tester", Date.now());
    const commit = async (version: number, state: unknown = m) =>
      (
        await pg.query<{ ok: boolean }>(
          "select public.scram_commit($1,$2,$3::jsonb) as ok",
          [m.id, version, JSON.stringify(state)],
        )
      ).rows[0].ok;
    assert.equal(await commit(-1), true);
    assert.equal(await commit(-1), false);
    assert.equal(await commit(0, { ...m, reason: "first claimant" }), true);
    assert.equal(await commit(0, { ...m, reason: "stale claimant" }), false);
    const saved = await pg.query<{ version: number; state: typeof m }>(
      "select * from public.scram_state where id=$1",
      [m.id],
    );
    assert.equal(Number(saved.rows[0].version), 1);
    assert.equal(saved.rows[0].state.reason, "first claimant");
    const limit = async () =>
      (
        await pg.query<{ ok: boolean }>(
          "select public.scram_limit('test',3,60) as ok",
        )
      ).rows[0].ok;
    assert.deepEqual(
      [await limit(), await limit(), await limit(), await limit()],
      [true, true, true, false],
    );
    await pg.exec("set role authenticated");
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      uid,
    ]);
    assert.equal(
      (await pg.query("select * from public.scram_signals")).rows.length,
      1,
    );
    assert.equal(
      (await pg.query("select * from public.scram_members")).rows.length,
      1,
    );
    await assert.rejects(
      pg.query("select * from public.scram_state"),
      /permission denied/,
    );
    await assert.rejects(commit(1), /permission denied/);
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      other,
    ]);
    assert.equal(
      (await pg.query("select * from public.scram_signals")).rows.length,
      0,
    );
    assert.equal(
      (await pg.query("select * from public.scram_members")).rows.length,
      0,
    );
    await pg.exec("reset role");
    assert.equal(await commit(1, { ...m, players: [] }), true);
    await pg.exec("set role authenticated");
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      uid,
    ]);
    assert.equal(
      (await pg.query("select * from public.scram_signals")).rows.length,
      0,
    );
    await pg.exec("reset role");
    await pg.query("delete from public.scram_state where id=$1", [m.id]);
    assert.equal(
      (await pg.query("select * from public.scram_members")).rows.length,
      0,
    );
    assert.equal(
      (await pg.query("select * from public.scram_signals")).rows.length,
      0,
    );
  } finally {
    await pg.close();
  }
});
