// Opt in ONLY with a disposable Supabase project. Creates and removes its own fixtures.
import WebSocket from "ws";
import type { WebSocketLikeConstructor } from "@supabase/realtime-js";
import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { createMatch, view } from "../lib/engine";
const enabled = process.env.SCRAM_INTEGRATION_CONFIRM === "disposable";
test(
  "real Postgres: private state, tenant RLS, atomic revision, durable limits",
  { skip: !enabled },
  async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
      anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    assert.ok(
      url && anon && key,
      "Set Supabase environment variables for a disposable project",
    );
    const opts = {
      realtime: { transport: WebSocket as unknown as WebSocketLikeConstructor },
      auth: { persistSession: false, autoRefreshToken: false },
    };
    const admin = createClient(url, key, opts),
      a = createClient(url, anon, opts),
      b = createClient(url, anon, opts);
    const first = await a.auth.signInAnonymously(),
      second = await b.auth.signInAnonymously();
    assert.ifError(first.error);
    assert.ifError(second.error);
    const uid = first.data.user!.id,
      other = second.data.user!.id,
      id = "TEST" + randomBytes(6).toString("hex").toUpperCase();
    try {
      const m = createMatch(id, uid, "Fixture", Date.now());
      const init = await admin.rpc("scram_commit", {
        match_id: id,
        expected_version: -1,
        new_state: m,
      });
      assert.ifError(init.error);
      assert.equal(init.data, true);
      const mine = await a.from("scram_signals").select("*").eq("id", id);
      assert.ifError(mine.error);
      assert.equal(mine.data!.length, 1);
      const theirs = await b.from("scram_signals").select("*").eq("id", id);
      assert.ifError(theirs.error);
      assert.equal(theirs.data!.length, 0);
      const exact = await a.from("scram_state").select("*").eq("id", id);
      assert.ok(exact.error || exact.data?.length === 0);
      const forbidden = await a.rpc("scram_commit", {
        match_id: id,
        expected_version: 0,
        new_state: m,
      });
      assert.ok(forbidden.error);
      const race = await Promise.all([
        admin.rpc("scram_commit", {
          match_id: id,
          expected_version: 0,
          new_state: { ...m, reason: "A" },
        }),
        admin.rpc("scram_commit", {
          match_id: id,
          expected_version: 0,
          new_state: { ...m, reason: "B" },
        }),
      ]);
      race.forEach((r) => assert.ifError(r.error));
      assert.deepEqual(race.map((r) => r.data).sort(), [false, true]);
      const saved = await admin
        .from("scram_state")
        .select("*")
        .eq("id", id)
        .single();
      assert.ifError(saved.error);
      assert.equal(saved.data.version, 1);
      assert.equal(view(saved.data.state, uid, Date.now()).players.length, 1);
      const limits = await Promise.all(
        Array.from({ length: 6 }, () =>
          admin.rpc("scram_limit", {
            bucket: id,
            maximum: 3,
            window_seconds: 60,
          }),
        ),
      );
      limits.forEach((r) => assert.ifError(r.error));
      assert.equal(limits.filter((r) => r.data).length, 3);
      // Removing participant membership in a CAS write must revoke signal access immediately.
      const removed = await admin.rpc("scram_commit", {
        match_id: id,
        expected_version: 1,
        new_state: { ...m, players: [] },
      });
      assert.ifError(removed.error);
      assert.equal(removed.data, true);
      const after = await a.from("scram_signals").select("*").eq("id", id);
      assert.ifError(after.error);
      assert.equal(after.data!.length, 0);
    } finally {
      await admin.from("scram_state").delete().eq("id", id);
      await admin.from("scram_buckets").delete().eq("key", id);
      await admin.auth.admin.deleteUser(uid);
      await admin.auth.admin.deleteUser(other);
    }
  },
);
