import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import type { WebSocketLikeConstructor } from "@supabase/realtime-js";
import { randomInt } from "node:crypto";
import { apply, createMatch, tick, type Match, type Action } from "./engine";
export function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw Error(
      "Multiplayer is not configured. Use the local simulation or configure Supabase.",
    );
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as unknown as WebSocketLikeConstructor },
  });
}
export async function authenticate(header: string | null) {
  if (!header?.startsWith("Bearer "))
    throw Error("Sign in to join a private lobby");
  const { data, error } = await db().auth.getUser(header.slice(7));
  if (error || !data.user) throw Error("Session expired. Reload to sign in");
  return data.user.id;
}
export async function limit(key: string, max: number, seconds: number) {
  const { data, error } = await db().rpc("scram_limit", {
    bucket: key,
    maximum: max,
    window_seconds: seconds,
  });
  if (error) throw Error("Rate limiter unavailable");
  if (!data) throw Error("Too many requests. Please wait before trying again");
}
export async function read(id: string) {
  const { data, error } = await db()
    .from("scram_state")
    .select("state,version")
    .eq("id", id)
    .single();
  if (error || !data) throw Error("Lobby not found or expired");
  if (Date.now() - data.state.created > 3600000) throw Error("Lobby expired");
  return data as { state: Match; version: number };
}
export async function commit(m: Match, version: number) {
  const { data, error } = await db().rpc("scram_commit", {
    match_id: m.id,
    expected_version: version,
    new_state: m,
  });
  if (error) throw Error("Could not save match");
  return data === true;
}
export async function mutate(id: string, uid: string, a: Action) {
  for (let n = 0; n < 8; n++) {
    const { state, version } = await read(id);
    if (a.type !== "join" && !state.players.some((p) => p.id === uid))
      throw Error("You are not in this lobby");
    apply(state, uid, a, Date.now(), () => randomInt(0, 2 ** 24) / 2 ** 24);
    state.updated = Date.now();
    if (await commit(state, version)) return state;
  }
  throw Error("Lobby is busy. Try again");
}
export async function advance(id: string) {
  for (let n = 0; n < 8; n++) {
    const { state, version } = await read(id);
    if (state.status !== "active") return state;
    const before = state.tick;
    tick(state, Date.now());
    if (state.tick === before && state.status === "active") return state;
    if (await commit(state, version)) return state;
  }
  throw Error("Lobby is busy. Try again");
}
export async function newLobby(uid: string, name: string) {
  await limit("create:" + uid, 3, 3600);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let n = 0; n < 5; n++) {
    const id = Array.from(
      { length: 8 },
      () => alphabet[randomInt(alphabet.length)],
    ).join("");
    const m = createMatch(id, uid, name, Date.now());
    if (await commit(m, -1)) return m;
  }
  throw Error("Could not create lobby. Try again");
}
