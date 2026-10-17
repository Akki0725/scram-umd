import { inside, CAMPUS_ARENA } from "./geo";
import { apply, createMatch, type Match } from "./engine";
export function demo(now: number): Match {
  const m = createMatch("DEMO2026", "you", "You", now - 180000);
  const names = [
    "Maya",
    "Jordan",
    "Alex",
    "Sam",
    "Riley",
    "Taylor",
    "Casey",
    "Drew",
    "Morgan",
    "Jamie",
    "Avery",
  ];
  names.forEach((name, i) =>
    apply(m, `bot${i}`, { type: "join", name }, m.created),
  );
  m.players.forEach((p, i) => {
    p.ready = true;
    p.fix = {
      x: m.zones![0].center.x + ((i % 3) - 1) * 80,
      y: m.zones![0].center.y + ((i % 4) - 1) * 50,
      accuracy: 8,
      at: m.created,
    };
  });
  m.players.forEach((p) => {
    if (p.fix && !inside(p.fix, CAMPUS_ARENA))
      p.fix = { ...m.zones![0].center, at: m.created, accuracy: 8 };
  });
  apply(m, "you", { type: "start", approved: true }, m.created, () => 0.8);
  m.start = now - 180000;
  m.tick = 180;
  if (m.players[0].role === "hunter")
    m.players.find((p) => p.role === "runner")!.role = "hunter";
  m.players[0].role = "runner";
  m.players[0].fix = { ...m.zones![0].center, at: now, accuracy: 8 };
  m.players.forEach((p) => {
    if (p.fix && !inside(p.fix, CAMPUS_ARENA))
      p.fix = { ...m.zones![0].center, at: now, accuracy: 8 };
    if (p.fix) p.fix.at = now;
  });
  m.events = [
    {
      at: now - 5000,
      text: "Next zone revealed · move toward the white circle",
    },
    { at: now - 60000, text: "Runner locations pinged · ~40 m grid" },
    { at: now - 180000, text: "Match started · 12 players dropped in" },
  ];
  m.lastPing = now;
  m.pings = m.players
    .filter((p) => p.role === "runner")
    .map((p) => ({
      id: p.id,
      name: p.name,
      x: Math.round(p.fix!.x / 40) * 40,
      y: Math.round(p.fix!.y / 40) * 40,
      at: now,
    }));
  return m;
}
