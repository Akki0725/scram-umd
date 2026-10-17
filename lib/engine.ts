import { distance, inside, FINALS, type Point } from "./geo";
export type Fix = Point & { accuracy: number; at: number };
export type Player = {
  id: string;
  name: string;
  role: "runner" | "hunter";
  hp: number;
  life: boolean;
  fix?: Fix;
  previousFix?: Fix;
  seen: number;
  joined: number;
  ready: boolean;
};
export type Pickup = Point & {
  id: string;
  kind: "med" | "life";
  claimed?: string;
};
export type Ping = Point & { id: string; name: string; at: number };
export type Match = {
  id: string;
  host: string;
  created: number;
  updated: number;
  status: "lobby" | "active" | "finished";
  players: Player[];
  start?: number;
  tick?: number;
  final: Point;
  pickups: Pickup[];
  pings: Ping[];
  lastPing: number;
  events: { at: number; text: string }[];
  winner?: string;
  reason?: string;
};
export type Action = {
  type: string;
  name?: string;
  fix?: Fix;
  pickupId?: string;
  approved?: boolean;
};
export const HEADSTART = 120,
  PHASE = 300,
  MAX_SECONDS = 2400;
export const DAMAGE = [1, 2, 5, 8, 10, 10];
export function zone(m: Match, at: number) {
  const elapsed = m.start ? Math.max(0, Math.floor((at - m.start) / 1000)) : 0;
  const phase = Math.min(5, Math.floor(elapsed / PHASE));
  const radius = [150, 125, 100, 75, 45, 22][phase];
  const center = { x: (m.final.x * phase) / 5, y: (m.final.y * phase) / 5 };
  return {
    phase,
    radius,
    center,
    elapsed,
    damage: DAMAGE[phase],
    next:
      phase < 5
        ? {
            center: { x: (m.final.x * (phase + 1)) / 5, y: 0 },
            radius: [150, 125, 100, 75, 45, 22][phase + 1],
          }
        : null,
    closesIn: PHASE - (elapsed % PHASE),
    preview: phase < 5 && elapsed % PHASE >= 180,
  };
}
export function event(m: Match, text: string, at: number) {
  m.events = [{ text, at }, ...m.events].slice(0, 24);
}
export function createMatch(
  id: string,
  uid: string,
  name: string,
  now: number,
): Match {
  return {
    id,
    host: uid,
    created: now,
    updated: now,
    status: "lobby",
    players: [player(uid, name, now)],
    final: { ...FINALS[0] },
    pickups: [],
    pings: [],
    lastPing: 0,
    events: [],
  };
}
function player(id: string, name: string, now: number): Player {
  return {
    id,
    name,
    role: "runner",
    hp: 100,
    life: false,
    seen: now,
    joined: now,
    ready: false,
  };
}
function finish(m: Match, now: number, reason: string) {
  m.status = "finished";
  m.reason = reason;
  const runners = m.players.filter((p) => p.role === "runner");
  if (runners.length === 1 && reason === "Last runner standing")
    m.winner = runners[0].id;
  m.pings = [];
  m.pickups = [];
  for (const p of m.players) {
    delete p.fix;
    delete p.previousFix;
  }
  event(m, reason, now);
}
function win(m: Match, now: number) {
  const count = m.players.filter((p) => p.role === "runner").length;
  if (count <= 1)
    finish(
      m,
      now,
      count === 1 ? "Last runner standing" : "No runners survived",
    );
}
export function tick(m: Match, now: number) {
  if (m.status !== "active" || !m.start) return;
  const end = Math.min(Math.floor((now - m.start) / 1000), MAX_SECONDS);
  let i = m.tick ?? 0;
  for (i += 1; i <= end; i++) {
    const at = m.start + i * 1000,
      z = zone(m, at);
    for (const p of m.players.filter((p) => p.role === "runner")) {
      const f = p.fix;
      const stale = !f || at - f.at > 45000;
      const outside = stale || !inside(f!) || distance(f!, z.center) > z.radius;
      if (outside) {
        p.hp = Math.max(0, p.hp - z.damage);
        if (!p.hp) {
          if (p.life) {
            p.life = false;
            p.hp = 100;
            event(m, `${p.name} used an extra life`, at);
          } else {
            p.role = "hunter";
            event(m, `${p.name} joined the hunt · storm`, at);
          }
        }
      }
    }
    if (i >= HEADSTART && (i - HEADSTART) % 60 === 0) {
      m.pings = m.players
        .filter((p) => p.role === "runner" && p.fix && at - p.fix.at <= 45000)
        .map((p) => ({
          id: p.id,
          name: p.name,
          x: Math.round(p.fix!.x / 40) * 40,
          y: Math.round(p.fix!.y / 40) * 40,
          at,
        }));
      m.lastPing = at;
      event(m, "Runner locations pinged · ~40 m grid", at);
    }
    win(m, at);
    if ((m as Match).status === "finished") break;
  }
  m.tick = Math.min(end, i - 1);
  m.updated = now;
  if (m.status === "active" && end >= MAX_SECONDS)
    finish(m, now, "Time limit · match drawn");
}
export function apply(
  m: Match,
  uid: string,
  a: Action,
  now: number,
  random = Math.random,
) {
  tick(m, now);
  let p = m.players.find((p) => p.id === uid);
  if (a.type === "join") {
    if (p) return;
    if (m.status !== "lobby") throw Error("This match has already started");
    if (m.players.length >= 20) throw Error("Lobby is full");
    m.players.push(player(uid, a.name || "Player", now));
    return;
  }
  if (!p) throw Error("You are not in this lobby");
  if (a.type === "heartbeat") {
    p.seen = now;
    return;
  }
  if (a.type === "end") {
    if (uid !== m.host) throw Error("Only the host can end this match");
    if (m.status !== "finished") finish(m, now, "Host ended the match");
    return;
  }
  if (a.type === "leave") {
    if (m.status === "active") {
      event(m, `${p.name} left the match`, now);
      m.players = m.players.filter((q) => q.id !== uid);
      if (uid === m.host) m.host = m.players[0]?.id || uid;
      win(m, now);
      return;
    }
    m.players = m.players.filter((q) => q.id !== uid);
    if (uid === m.host) m.host = m.players[0]?.id || uid;
    return;
  }
  if (m.status === "finished") throw Error("This match has ended");
  if (a.type === "location") {
    const f = a.fix;
    if (
      !f ||
      !Number.isFinite(f.x) ||
      !Number.isFinite(f.y) ||
      !Number.isFinite(f.accuracy) ||
      f.accuracy < 0 ||
      f.accuracy > 35 ||
      Math.abs(now - f.at) > 15000
    )
      throw Error("A fresh GPS fix with accuracy ≤35 m is required");
    if (p.fix) {
      const dt = (f.at - p.fix.at) / 1000;
      if (dt < 2) throw Error("GPS updates are too frequent");
      if (
        distance(f, p.fix) >
        8 * dt + Math.min(35, p.fix.accuracy + f.accuracy)
      )
        throw Error("GPS jumped too far. Wait for a stable fix");
    }
    p.previousFix = p.fix;
    p.fix = f;
    p.seen = now;
    return;
  }
  if (a.type === "ready") {
    if (m.status !== "lobby") throw Error("Match already started");
    p.ready = !p.ready;
    p.seen = now;
    return;
  }
  if (a.type === "start") {
    if (uid !== m.host) throw Error("Only the host can start");
    if (m.status !== "lobby") throw Error("Match already started");
    if (!a.approved)
      throw Error("Approve the outdoor play area and safety rules first");
    if (m.players.length < 3) throw Error("At least 3 players are needed");
    if (
      m.players.some(
        (q) => !q.ready || !q.fix || now - q.fix.at > 30000 || !inside(q.fix),
      )
    )
      throw Error(
        "Everyone must be ready with fresh GPS inside the approved boundary",
      );
    const shuffled = [...m.players];
    for (let j = shuffled.length - 1; j > 0; j--) {
      const k = Math.floor(random() * (j + 1));
      [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
    }
    const hunters = new Set(
      shuffled.slice(0, Math.ceil(m.players.length * 0.25)).map((q) => q.id),
    );
    for (const q of m.players) {
      q.role = hunters.has(q.id) ? "hunter" : "runner";
      q.hp = 100;
    }
    m.final = {
      ...FINALS[
        Math.min(FINALS.length - 1, Math.floor(random() * FINALS.length))
      ],
    };
    m.pickups = [
      { id: "med-west", kind: "med", x: -100, y: 12 },
      { id: "med-east", kind: "med", x: 100, y: -12 },
      { id: "life-west", kind: "life", x: -60, y: -15 },
      { id: "life-east", kind: "life", x: 60, y: 15 },
    ];
    m.status = "active";
    m.start = now;
    m.tick = 0;
    event(m, "Runners scatter · hunters wait 2 minutes", now);
    return;
  }
  if (m.status !== "active") throw Error("Start the match first");
  if (a.type === "tag") {
    if (p.role !== "runner") throw Error("You are already a hunter");
    if (now - m.start! < HEADSTART * 1000)
      throw Error("Hunters have not been released");
    p.role = "hunter";
    p.hp = 0;
    event(m, `${p.name} was tagged · joined the hunt`, now);
    win(m, now);
    return;
  }
  if (a.type === "claim") {
    if (p.role !== "runner") throw Error("Only runners can use pickups");
    const item = m.pickups.find((i) => i.id === a.pickupId);
    if (!item || item.claimed)
      throw Error("This pickup has already been claimed");
    const f = p.fix,
      prev = p.previousFix,
      z = zone(m, now);
    if (
      !f ||
      !prev ||
      now - f.at > 10000 ||
      f.at - prev.at < 8000 ||
      f.at - prev.at > 20000 ||
      f.accuracy > 20 ||
      prev.accuracy > 20 ||
      distance(f, item) > 12 ||
      distance(prev, item) > 12 ||
      !inside(f) ||
      distance(item, z.center) > z.radius
    )
      throw Error(
        "Stand within 12 m for two accurate fixes, 8–20 seconds apart, inside the safe zone",
      );
    if (item.kind === "life" && p.life)
      throw Error("You already have an extra life");
    if (item.kind === "med" && p.hp === 100)
      throw Error("Your health is already full");
    item.claimed = uid;
    if (item.kind === "med") p.hp = Math.min(100, p.hp + 40);
    else p.life = true;
    event(
      m,
      `${p.name} claimed ${item.kind === "med" ? "a med kit" : "an extra life"}`,
      now,
    );
    return;
  }
  throw Error("Unknown action");
}
export function view(m: Match, uid: string, now: number) {
  const p = m.players.find((p) => p.id === uid);
  if (!p) throw Error("You are not in this lobby");
  const { final, players, pings, ...publicMatch } = m;
  void final;
  return {
    ...publicMatch,
    players: players.map((q) => ({
      id: q.id,
      name: q.name,
      role: q.role,
      hp: q.id === uid ? q.hp : undefined,
      life: q.id === uid ? q.life : undefined,
      ready: q.ready,
      online: now - q.seen < 30000,
      gpsReady: !!q.fix && now - q.fix.at < 30000 && inside(q.fix),
      ...(q.id === uid && m.status !== "finished" ? { fix: q.fix } : {}),
    })),
    pings:
      m.status === "active" &&
      p.role === "hunter" &&
      now - (m.start || now) >= HEADSTART * 1000
        ? pings.filter(
            (q) => players.find((r) => r.id === q.id)?.role === "runner",
          )
        : [],
    zone: {
      ...zone(m, now),
      next: zone(m, now).preview ? zone(m, now).next : null,
    },
    serverNow: now,
    you: uid,
  };
}
export type GameView = ReturnType<typeof view>;
