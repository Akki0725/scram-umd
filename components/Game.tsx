"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock,
  Copy,
  Crosshair,
  Flag,
  Heart,
  HelpCircle,
  Info,
  Link,
  Map as MapIcon,
  MapPin,
  Radio,
  Shield,
  Skull,
  Sparkles,
  Target,
  Trophy,
  Users,
  Volume2,
  X,
  Zap,
  LogOut,
  Settings2,
  Play,
  WifiOff,
} from "lucide-react";
import TacticalMap from "./TacticalMap";
import {
  apply,
  tick,
  view,
  HEADSTART,
  type Action,
  type GameView,
  type Match,
  type Pickup,
} from "@/lib/engine";
import { demo } from "@/lib/demo";
import { fromLngLat } from "@/lib/geo";
import { configured, request, supabase } from "@/lib/client";
const time = (n: number) =>
  `${Math.floor(Math.max(0, n) / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(Math.max(0, n) % 60)
    .toString()
    .padStart(2, "0")}`;
type Modal = "connect" | "rules" | "tag" | "squad" | "safety" | "pickup" | null;
export default function Game() {
  const [game, setGame] = useState<GameView | null>(null),
    [local, setLocal] = useState(true),
    [modal, setModal] = useState<Modal>(null),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(""),
    [code, setCode] = useState(""),
    [approved, setApproved] = useState(false),
    [gps, setGps] = useState("Location off"),
    [gpsOn, setGpsOn] = useState(false),
    [tab, setTab] = useState("map"),
    [selected, setSelected] = useState<Pickup | null>(null),
    [sound, setSound] = useState(false),
    [now, setNow] = useState(Date.now());
  const sim = useRef<Match | null>(null),
    current = useRef<GameView | null>(null),
    watch = useRef<number | null>(null),
    lastFix = useRef(0),
    offset = useRef(0),
    lastEvent = useRef("");
  const notify = useCallback((s: string) => {
    setToast(s);
  }, []);
  const update = useCallback((v: GameView) => {
    current.current = v;
    offset.current = v.serverNow - Date.now();
    setGame(v);
  }, []);
  const reset = useCallback(() => {
    sim.current = demo(Date.now());
    setLocal(true);
    setGps("Simulated · ±8 m");
    update(view(sim.current, "you", Date.now()));
    setModal(null);
    setNow(Date.now());
  }, [update]);
  useEffect(() => {
    reset();
    const saved = localStorage.getItem("scram-code");
    const shared = new URLSearchParams(location.search).get("lobby");
    if (shared) {
      setCode(shared.toUpperCase());
      setModal("connect");
    } else if (saved && configured) {
      request(saved)
        .then((v) => {
          setLocal(false);
          setGps("Location off");
          update(v);
        })
        .catch(() => {
          localStorage.removeItem("scram-code");
        });
    }
  }, [reset, update]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      if (local && sim.current) {
        const m = sim.current;
        for (const p of m.players) {
          p.seen = Date.now();
          if (p.fix) p.fix.at = Date.now();
        }
        tick(m, Date.now());
        update(view(m, "you", Date.now()));
      }
    }, 1000);
    return () => clearInterval(t);
  }, [local, update]);
  useEffect(() => {
    if (local || !game) return;
    const id = game.id;
    let alive = true;
    let pending = false;
    let lastFetch = 0;
    const refresh = async () => {
      if (pending || Date.now() - lastFetch < 2500) return;
      pending = true;
      lastFetch = Date.now();
      try {
        const v = await request(id);
        if (alive) {
          update(v);
          setError("");
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        pending = false;
      }
    };
    const t = setInterval(refresh, 3000),
      h = setInterval(() => {
        request(id, "heartbeat").catch(() => {});
      }, 15000);
    const channel = supabase
      ?.channel(`scram-${id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "scram_signals",
          filter: `id=eq.${id}`,
        },
        refresh,
      )
      .subscribe();
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive = false;
      clearInterval(t);
      clearInterval(h);
      if (channel) supabase?.removeChannel(channel);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [local, game?.id, update]);
  useEffect(() => {
    const latest = game?.events[0];
    if (!latest) return;
    const key = latest.at + latest.text;
    if (lastEvent.current && lastEvent.current !== key) {
      notify(latest.text);
      if (sound) {
        try {
          const ctx = new AudioContext();
          const osc = ctx.createOscillator(),
            gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          gain.gain.value = 0.04;
          osc.frequency.value = 600;
          osc.start();
          osc.stop(ctx.currentTime + 0.12);
          osc.onended = () => {
            void ctx.close();
          };
        } catch {}
      }
    }
    lastEvent.current = key;
  }, [game?.events, sound, notify]);
  useEffect(() => {
    if (game?.status === "finished" && watch.current !== null) {
      navigator.geolocation.clearWatch(watch.current);
      watch.current = null;
      setGpsOn(false);
      setGps("Location stopped");
    }
  }, [game?.status]);
  useEffect(
    () => () => {
      if (watch.current !== null)
        navigator.geolocation.clearWatch(watch.current);
    },
    [],
  );
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>("[role=dialog]");
    dialog?.querySelector<HTMLElement>("button,input")?.focus();
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setModal(null);
        setError("");
      }
      if (e.key === "Tab" && dialog) {
        const targets = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),[tabindex="0"]',
          ),
        );
        const first = targets[0],
          last = targets[targets.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("keydown", keys);
      previous?.focus();
    };
  }, [modal]);
  async function act(type: string, extra: Record<string, unknown> = {}) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (local) {
        if (!sim.current) return;
        apply(sim.current, "you", { type, ...extra } as Action, Date.now());
        update(view(sim.current, "you", Date.now()));
      } else {
        const data = await request(game!.id, type, extra);
        if (type === "leave") {
          localStorage.removeItem("scram-code");
          stopGps();
          reset();
          return;
        }
        update(data);
      }
      if (type === "tag" || type === "claim") setModal(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function stopGps() {
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
    setGpsOn(false);
    setGps("Location off");
  }
  function enableGps() {
    if (local) {
      notify(
        "This is a local simulation. Your actual location is not collected.",
      );
      return;
    }
    if (!navigator.geolocation) {
      setError("This browser does not support location");
      return;
    }
    if (watch.current !== null) return;
    setGps("Requesting location…");
    setGpsOn(true);
    watch.current = navigator.geolocation.watchPosition(
      async (position) => {
        const at = Date.now();
        if (at - lastFix.current < 10000) return;
        lastFix.current = at;
        setGps(`±${Math.round(position.coords.accuracy)} m accuracy`);
        try {
          const point = fromLngLat(
            position.coords.latitude,
            position.coords.longitude,
          );
          const v = await request(current.current!.id, "location", {
            fix: {
              ...point,
              accuracy: position.coords.accuracy,
              at: position.timestamp,
            },
          });
          update(v);
        } catch (e) {
          setError((e as Error).message);
        }
      },
      (e) => {
        setGps(e.code === 1 ? "Permission denied" : "GPS unavailable");
        setError(
          "Enable precise location and keep this page open. Locked browsers may stop GPS.",
        );
        if (e.code === 1) stopGps();
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  }
  async function connect(type: "create" | "join") {
    setBusy(true);
    setError("");
    try {
      if (!name.trim()) throw Error("Enter a display name");
      const v = await request(
        type === "create" ? "" : code.toUpperCase(),
        type,
        { name: name.trim() },
      );
      stopGps();
      setLocal(false);
      localStorage.setItem("scram-code", v.id);
      update(v);
      setModal(null);
      setApproved(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function share() {
    if (local) {
      notify(
        "Demo lobbies cannot be shared. Connect Supabase for multiplayer.",
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(
        `${location.origin}/?lobby=${game!.id}`,
      );
      notify("Private lobby link copied");
    } catch {
      notify(`Lobby code: ${game!.id}`);
    }
  }
  if (!game)
    return (
      <div className="loading">
        <strong>
          SCRAM<span>↗</span>
        </strong>
        <p>GETTING THE FIELD READY</p>
      </div>
    );
  const me = game.players.find((p) => p.id === game.you)!;
  const runners = game.players.filter((p) => p.role === "runner"),
    hunters = game.players.filter((p) => p.role === "hunter");
  const elapsed = game.start
    ? Math.max(0, Math.floor((now + offset.current - game.start) / 1000))
    : 0;
  const release = HEADSTART - elapsed;
  const z = game.zone;
  const nextPing = release > 0 ? release : 60 - ((elapsed - HEADSTART) % 60);
  const winner = game.players.find((p) => p.id === game.winner);
  const active = game.status === "active";
  const supply = game.pickups.filter((p) => !p.claimed);
  const inStorm =
    !!me.fix &&
    (Math.hypot(me.fix.x - z.center.x, me.fix.y - z.center.y) > z.radius ||
      Math.abs(me.fix.y) > 30 ||
      Math.abs(me.fix.x) > 140 ||
      Math.hypot(me.fix.x, me.fix.y) <= 18);
  return (
    <div className="app">
      <aside className="rail">
        <button
          className="brand-mark"
          aria-label="SCRAM home"
          onClick={() => setModal("connect")}
        >
          S<span>↗</span>
        </button>
        <div className="rail-group">
          <button
            className={tab === "map" ? "selected" : ""}
            aria-label="Game map"
            onClick={() => {
              setTab("map");
              setModal(null);
            }}
          >
            <MapIcon size={22} />
          </button>
          <button
            className={tab === "squad" ? "selected" : ""}
            aria-label="Squad"
            onClick={() => {
              setTab("squad");
              setModal("squad");
            }}
          >
            <Users size={22} />
          </button>
          <button aria-label="How to play" onClick={() => setModal("rules")}>
            <Flag size={22} />
          </button>
        </div>
        <div className="rail-bottom">
          <button
            aria-label="Sound notifications"
            onClick={() => {
              setSound((v) => !v);
              notify(sound ? "Sound off" : "Sound on");
            }}
          >
            <Volume2 size={21} />
            <i className={sound ? "sound-on" : ""} />
          </button>
          <button
            aria-label="Settings and safety"
            onClick={() => setModal("safety")}
          >
            <Settings2 size={21} />
          </button>
          <div className="avatar">{me.name.slice(0, 1).toUpperCase()}</div>
        </div>
      </aside>
      <div className="app-main">
        <header className="header">
          <div className="wordmark">
            SCRAM<span>↗</span>
            <small>GO OUTSIDE. STAY ALIVE.</small>
          </div>
          <div className="header-right">
            <span className="campus">
              <MapPin size={14} /> UNIVERSITY OF MARYLAND
            </span>
            <button className="help-button" onClick={() => setModal("rules")}>
              <HelpCircle size={17} />
              <span>How to play</span>
            </button>
            <button
              className="avatar small"
              aria-label="Open squad"
              onClick={() => setModal("squad")}
            >
              {me.name.slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>
        <div className="mode-banner">
          <div>
            <span className="live-dot" />
            {local ? (
              <>
                <strong>LOCAL SIMULATION</strong>
                <span>Explore the game. No real GPS or other players.</span>
              </>
            ) : (
              <>
                <strong>PRIVATE MULTIPLAYER</strong>
                <span>Only this lobby can access match information.</span>
              </>
            )}
          </div>
          <button onClick={() => setModal("connect")}>
            {local ? "Play with friends" : "Switch lobby"}
            <ArrowUpRight size={14} />
          </button>
        </div>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow muted">
                {game.status === "lobby"
                  ? "GET YOUR PEOPLE TOGETHER"
                  : "THE CAMPUS IS YOUR BATTLEGROUND"}
              </div>
              <h1>
                {game.status === "lobby"
                  ? "Ready. Set. Scram."
                  : game.status === "finished"
                    ? "That’s a wrap."
                    : "Stay in the circle."}
                <span className="heading-dot" />
              </h1>
              <p>
                {game.status === "lobby"
                  ? "Invite your friends. Pick your hiding spot. The hunt is almost on."
                  : "Outsmart the hunters. Outlast the storm. Be the last one standing."}
              </p>
            </div>
            <button className="lobby-code" onClick={share}>
              <div>
                <span>PRIVATE LOBBY</span>
                <strong>{game.id}</strong>
              </div>
              <Copy size={17} />
            </button>
          </div>
          <div className="game-grid">
            <section className="dashboard">
              <div className="status-card">
                <div className="card-line">
                  <span className="eyebrow">
                    <span className={active ? "live-dot" : "idle-dot"} />
                    {game.status === "lobby"
                      ? "WAITING ROOM"
                      : active
                        ? "MATCH IN PROGRESS"
                        : "MATCH COMPLETE"}
                  </span>
                  <span className="round-label">{time(elapsed)}</span>
                </div>
                <div className="role-heading">
                  <div className={`role-icon ${me.role}`}>
                    {me.role === "runner" ? (
                      <Zap size={28} />
                    ) : (
                      <Crosshair size={28} />
                    )}
                  </div>
                  <div>
                    <span className="eyebrow muted">
                      {game.status === "lobby"
                        ? "YOUR NEXT ADVENTURE"
                        : "YOUR ROLE"}
                    </span>
                    <h2>
                      {game.status === "lobby"
                        ? "Waiting to drop"
                        : me.role === "runner"
                          ? "You’re a runner."
                          : "You’re a hunter."}
                    </h2>
                  </div>
                </div>
                <p className="role-description">
                  {game.status === "lobby"
                    ? "Teams are randomized when the host starts."
                    : release > 0
                      ? me.role === "hunter"
                        ? "Hold your position. Give runners their head start."
                        : "Your head start is ticking. Find your spot."
                      : me.role === "runner"
                        ? "Stay hidden. Keep moving. Trust no footsteps."
                        : "Watch the pings. A gentle tag starts a new hunt."}
                </p>
                <div className="team-stats">
                  <div>
                    <span className="stat-number lime-text">
                      {runners.length.toString().padStart(2, "0")}
                    </span>
                    <span>
                      <Zap size={12} /> RUNNERS
                    </span>
                  </div>
                  <div>
                    <span className="stat-number coral-text">
                      {hunters.length.toString().padStart(2, "0")}
                    </span>
                    <span>
                      <Crosshair size={12} /> HUNTERS
                    </span>
                  </div>
                  <div>
                    <span className="stat-number">
                      {game.players.length}
                      <small>/20</small>
                    </span>
                    <span>
                      <Users size={12} /> PLAYERS
                    </span>
                  </div>
                </div>
                {game.status === "lobby" ? (
                  <>
                    <button
                      className="primary full"
                      onClick={() => act("ready")}
                      disabled={busy}
                    >
                      {me.ready ? <Check size={16} /> : <Shield size={16} />}{" "}
                      {me.ready ? "Ready · tap to unready" : "I’m ready"}
                    </button>
                    {game.host === me.id && (
                      <>
                        <label className="check-label">
                          <input
                            type="checkbox"
                            checked={approved}
                            onChange={(e) => setApproved(e.target.checked)}
                          />
                          I inspected the play area and briefed all players.
                        </label>
                        <button
                          className="primary full"
                          disabled={busy || !approved}
                          onClick={() => act("start", { approved })}
                        >
                          <Play size={16} /> START MATCH
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <div className="health-label">
                      <span>
                        <Heart size={14} />{" "}
                        {me.role === "runner" ? "YOUR HEALTH" : "HUNTER STATUS"}
                      </span>
                      <strong>
                        {me.role === "runner" ? `${me.hp} / 100` : "ACTIVE"}
                      </strong>
                    </div>
                    <div className="health-track">
                      <div
                        style={{
                          width: `${me.role === "runner" ? me.hp : 100}%`,
                        }}
                      />
                    </div>
                    <div className="health-sub">
                      <span>
                        {me.life ? (
                          <>
                            <Sparkles size={12} /> Extra life equipped
                          </>
                        ) : (
                          <>
                            <Shield size={12} />{" "}
                            {me.role === "runner"
                              ? "Find supplies to recover"
                              : "Hunters are immune to the storm"}
                          </>
                        )}
                      </span>
                      {inStorm && me.role === "runner" && active && (
                        <b className="coral-text">IN STORM</b>
                      )}
                    </div>
                  </>
                )}
              </div>
              <div className="storm-card">
                <div className="storm-header">
                  <div className="storm-symbol">
                    <Radio size={21} />
                  </div>
                  <div>
                    <span className="eyebrow">STORM · PHASE {z.phase + 1}</span>
                    <h3>
                      {z.phase === 5
                        ? "Final circle"
                        : release > 0
                          ? "Hunters release in"
                          : "Zone closes in"}
                    </h3>
                  </div>
                  <span className="damage">−{z.damage} HP/s</span>
                </div>
                <div className="storm-timer">
                  {time(release > 0 ? release : z.closesIn)}
                  <span>
                    {z.phase === 5
                      ? "HOLD YOUR GROUND"
                      : z.preview
                        ? "NEXT ZONE REVEALED"
                        : "FIND YOUR SAFE SPOT"}
                  </span>
                </div>
                <div className="phase-track">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <i key={i} className={i <= z.phase ? "on" : ""} />
                  ))}
                </div>
                <p>
                  <Info size={13} />
                  {z.preview
                    ? "The dashed white circle is your next safe zone."
                    : "The next circle appears 2 minutes before closing."}
                </p>
              </div>
              <div className="ping-card">
                <div className="ping-icon">
                  <Radio size={21} />
                </div>
                <div>
                  <span className="eyebrow muted">NEXT LOCATION PING</span>
                  <strong>{time(nextPing)}</strong>
                  <p>
                    {me.role === "runner"
                      ? "Hunters see your approximate position."
                      : "Frozen runner snapshots. Never a live trail."}
                  </p>
                </div>
                <span className="radar-ring" />
              </div>
              <button
                className="tag-button"
                disabled={!active || me.role !== "runner" || release > 0}
                onClick={() => setModal("tag")}
              >
                <Target size={18} />
                <span>I WAS TAGGED</span>
                <ChevronRight size={17} />
              </button>
              <p className="tag-caption">
                Only confirm after a real, gentle physical tag.
              </p>
            </section>
            <section className="map-column">
              <TacticalMap
                game={game}
                onPickup={(p) => {
                  setSelected(p);
                  setModal("pickup");
                }}
              />
              <div className="under-map">
                <div>
                  <span className="gps-dot" />
                  <span>{gps}</span>
                  {!local && (
                    <button onClick={() => (gpsOn ? stopGps() : enableGps())}>
                      {gpsOn ? "Stop sharing" : "Enable GPS"}
                    </button>
                  )}
                </div>
                <span>
                  <Shield size={12} /> OUTDOORS ONLY · WALK, DON’T CHASE
                </span>
              </div>
              <div className="supply-section">
                <div className="section-title">
                  <h3>
                    On the field <span>{supply.length} SUPPLIES</span>
                  </h3>
                  <span>
                    Visible to both teams <Users size={13} />
                  </span>
                </div>
                <div className="supply-grid">
                  {supply.map((p) => (
                    <button
                      key={p.id}
                      className={`supply-card ${p.kind}`}
                      onClick={() => {
                        setSelected(p);
                        setModal("pickup");
                      }}
                    >
                      <span className="supply-icon">
                        {p.kind === "med" ? (
                          <Heart size={21} />
                        ) : (
                          <Sparkles size={21} />
                        )}
                      </span>
                      <div>
                        <strong>
                          {p.kind === "med" ? "Med kit" : "Extra life"}
                        </strong>
                        <small>
                          {p.kind === "med" ? "+40 HP" : "One storm revival"}
                        </small>
                      </div>
                      <ArrowUpRight size={16} />
                    </button>
                  ))}
                  {!supply.length && (
                    <p className="muted">
                      {game.status === "lobby"
                        ? "Supplies appear when the match begins."
                        : "No supplies remaining."}
                    </p>
                  )}
                </div>
              </div>
            </section>
          </div>
          <section className="bottom-grid">
            <div className="feed">
              <div className="section-title">
                <h3>
                  <Radio size={14} /> Field updates
                </h3>
                <span>LIVE FEED</span>
              </div>
              {game.events.slice(0, 3).map((e, i) => (
                <div className="feed-line" key={e.at + e.text}>
                  <span>
                    {time(game.start ? (e.at - game.start) / 1000 : 0)}
                  </span>
                  <i className={i === 0 ? "lime" : ""} />
                  <p>{e.text}</p>
                </div>
              ))}
            </div>
            <div className="rules-card">
              <span className="safety-icon">
                <Shield size={22} />
              </span>
              <div>
                <h3>Play smart. Get home safe.</h3>
                <p>
                  Stay outdoors, respect campus, and give everyone space.
                  <br />A game is never a reason to cross a road in a hurry.
                </p>
                <button onClick={() => setModal("safety")}>
                  THE GROUND RULES <ArrowUpRight size={13} />
                </button>
              </div>
            </div>
          </section>
          <footer>
            <span>
              SCRAM <b>↗</b>
              <small> A LITTLE LESS SCREEN. A LOT MORE OUTSIDE.</small>
            </span>
            <span>
              Built for the Terps. <span className="terp-square" /> Independent
              student game.
            </span>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav">
        <button
          onClick={() => {
            setTab("map");
            setModal(null);
          }}
          className={tab === "map" ? "selected" : ""}
        >
          <MapIcon size={20} />
          MAP
        </button>
        <button
          onClick={() => {
            setTab("squad");
            setModal("squad");
          }}
        >
          <Users size={20} />
          SQUAD
        </button>
        <button
          onClick={() => {
            setSelected(supply[0] || null);
            setModal("pickup");
          }}
        >
          <Heart size={20} />
          SUPPLIES
        </button>
        <button onClick={() => setModal("rules")}>
          <Flag size={20} />
          RULES
        </button>
      </nav>
      {error && (
        <div className="error-toast" role="alert">
          <WifiOff size={16} />
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      {game.status === "finished" && !modal && (
        <div className="modal-backdrop">
          <div className="modal result">
            <div className="victory-icon">
              <Trophy size={44} />
            </div>
            <span className="eyebrow lime-text">
              {local ? "SIMULATION COMPLETE" : "MATCH COMPLETE"}
            </span>
            <h2>{winner ? `${winner.name} takes it.` : "The hunt is over."}</h2>
            <p>{game.reason}</p>
            <div className="result-stats">
              <span>{game.players.length} PLAYERS</span>
              <span>{time(elapsed)} MATCH TIME</span>
            </div>
            <p className="muted">
              Location sharing has stopped. All stored match positions have been
              cleared.
            </p>
            <button
              className="primary full"
              onClick={
                local
                  ? reset
                  : () => {
                      localStorage.removeItem("scram-code");
                      reset();
                    }
              }
            >
              BACK TO THE FIELD <ArrowUpRight size={16} />
            </button>
          </div>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <button
              className="close-modal"
              aria-label="Close dialog"
              onClick={() => {
                setModal(null);
                setError("");
              }}
            >
              <X size={20} />
            </button>
            {modal === "connect" && (
              <>
                <span className="eyebrow lime-text">BRING YOUR PEOPLE</span>
                <h2 id="modal-title">The hunt starts here.</h2>
                <p>Private lobbies. 3–20 friends. One last runner.</p>
                {!configured ? (
                  <div className="setup-note">
                    <Shield size={24} />
                    <div>
                      <strong>Multiplayer needs Supabase setup</strong>
                      <p>
                        This preview is a local simulation. Add your Supabase
                        keys, apply the included migration, and start the match
                        worker to play together. See README.md in the source.
                      </p>
                    </div>
                  </div>
                ) : null}
                <label className="field-label">
                  YOUR DISPLAY NAME
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={18}
                    placeholder="What should we call you?"
                  />
                </label>
                <button
                  className="primary full"
                  disabled={
                    !configured ||
                    busy ||
                    (!local && game.status !== "finished")
                  }
                  onClick={() => connect("create")}
                >
                  CREATE PRIVATE LOBBY <ArrowUpRight size={17} />
                </button>
                <div className="or">OR JOIN YOUR FRIENDS</div>
                <label className="field-label">
                  8-CHARACTER LOBBY CODE
                  <input
                    value={code}
                    onChange={(e) =>
                      setCode(
                        e.target.value.replace(/[^a-z2-9]/gi, "").toUpperCase(),
                      )
                    }
                    maxLength={8}
                    placeholder="E.G. CAMPUSAB"
                    className="code-input"
                  />
                </label>
                <button
                  className="secondary full"
                  disabled={
                    !configured ||
                    busy ||
                    code.length !== 8 ||
                    (!local && game.status !== "finished")
                  }
                  onClick={() => connect("join")}
                >
                  JOIN LOBBY <Link size={16} />
                </button>
                {!local && game.status !== "finished" && (
                  <p className="muted">
                    Leave your current lobby from Squad before switching.
                  </p>
                )}
                <button className="text-button" onClick={() => setModal(null)}>
                  Explore the {local ? "simulation" : "current match"}{" "}
                  <ChevronRight size={14} />
                </button>
              </>
            )}
            {modal === "rules" && (
              <>
                <span className="eyebrow lime-text">
                  A REAL-WORLD BATTLE ROYALE
                </span>
                <h2 id="modal-title">Hide. Seek. Scram.</h2>
                <div className="rule-list">
                  {[
                    [
                      Zap,
                      "01 · Get a head start",
                      "25% become hunters, rounded up. Runners get 2 minutes to scatter.",
                    ],
                    [
                      Radio,
                      "02 · Stay one step ahead",
                      "Every 60 seconds, hunters see a frozen ~40 m grid snapshot of all runners with fresh GPS.",
                    ],
                    [
                      MapIcon,
                      "03 · Respect the circle",
                      "The safe circle shrinks every 5 minutes. Preview the next circle 2 minutes before it closes. Outside: 1, 2, 5, 8, then 10 HP per second.",
                    ],
                    [
                      Target,
                      "04 · Tagged? Join the hunt",
                      "A runner self-confirms a real gentle tag. They immediately become a hunter. Last runner wins.",
                    ],
                    [
                      Heart,
                      "05 · Find a second chance",
                      "Med kits heal 40 HP. Extra lives restore 100 HP once after storm depletion; they do not cancel tags.",
                    ],
                  ].map(([Icon, title, body]) => {
                    const I = Icon as typeof Zap;
                    return (
                      <div key={title as string}>
                        <I size={21} />
                        <section>
                          <strong>{title as string}</strong>
                          <p>{body as string}</p>
                        </section>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {modal === "safety" && (
              <>
                <span className="eyebrow lime-text">PEOPLE BEFORE POINTS</span>
                <h2 id="modal-title">The ground rules.</h2>
                <div className="rule-list">
                  {[
                    "Organizer must inspect and approve the candidate Mall footprint before play. Campus access, closures, events, and permission must be checked that day.",
                    "The playable area is the intersection of the marked outdoor boundary and the current circle. The central exclusion is out of bounds. Never enter buildings, streets, construction, or restricted areas.",
                    "Walk. No tackling, grabbing, pushing, ambushes, or contact with nonparticipants. Only gentle, agreed tags; anyone can stop playing.",
                    "Look up from the screen. Stop in a safe place to use the map. The tactical map is a schematic; check the street map and real surroundings.",
                    "GPS is approximate. Keep the browser visible and your phone unlocked. After 45 seconds without a valid fix, storm damage applies until GPS resumes.",
                    "Location sharing begins only when you enable it, stops at match end or when leaving, and can be stopped at any time. Stopping GPS during play does not pause storm damage. Exact coordinates are not shared with other players.",
                  ].map((t, i) => (
                    <div key={i}>
                      <Shield size={19} />
                      <p>{t}</p>
                    </div>
                  ))}
                </div>
                <button className="primary full" onClick={() => setModal(null)}>
                  GOT IT <Check size={16} />
                </button>
              </>
            )}
            {modal === "tag" && (
              <>
                <span className="modal-tag-icon">
                  <Target size={30} />
                </span>
                <h2 id="modal-title">You’ve been tagged?</h2>
                <p>
                  Confirm only after a hunter gently tagged you in person.
                  You’ll immediately join the hunters. This cannot be undone,
                  even with an extra life.
                </p>
                <button
                  className="danger full"
                  disabled={busy}
                  onClick={() => act("tag")}
                >
                  YES, I WAS TAGGED <Crosshair size={17} />
                </button>
                <button
                  className="secondary full"
                  onClick={() => setModal(null)}
                >
                  STILL IN THE GAME
                </button>
              </>
            )}
            {modal === "squad" && (
              <>
                <span className="eyebrow lime-text">
                  YOUR LOBBY · {game.players.length}/20
                </span>
                <h2 id="modal-title">The usual suspects.</h2>
                <div className="roster">
                  {game.players.map((p) => (
                    <div key={p.id}>
                      <span className={`roster-avatar ${p.role}`}>
                        {p.name[0]}
                      </span>
                      <div>
                        <strong>
                          {p.name}
                          {p.id === game.you ? " (you)" : ""}
                          {p.id === game.host ? " · HOST" : ""}
                        </strong>
                        <small>
                          {game.status === "lobby"
                            ? p.ready
                              ? "READY"
                              : "NOT READY"
                            : p.role.toUpperCase()}{" "}
                          · {p.online ? "ONLINE" : "DISCONNECTED"}
                          {game.status === "lobby"
                            ? p.gpsReady
                              ? " · GPS READY"
                              : " · GPS NEEDED"
                            : ""}
                        </small>
                      </div>
                      <span className={p.online ? "live-dot" : "idle-dot"} />
                    </div>
                  ))}
                </div>
                <button className="secondary full" onClick={share}>
                  <Copy size={16} /> COPY INVITE LINK
                </button>
                {local && (
                  <button
                    className="secondary full"
                    onClick={() => {
                      if (sim.current) {
                        const p = sim.current.players[0];
                        p.role = p.role === "runner" ? "hunter" : "runner";
                        update(view(sim.current, "you", Date.now()));
                        notify("Simulation role switched");
                      }
                    }}
                  >
                    SIMULATION: SWITCH YOUR ROLE
                  </button>
                )}
                {game.host === me.id && active && (
                  <button
                    className="text-button coral-text"
                    onClick={() => act("end")}
                  >
                    End match for everyone
                  </button>
                )}
                <button
                  className="text-button"
                  onClick={() => (local ? reset() : act("leave"))}
                >
                  <LogOut size={14} />{" "}
                  {local ? "Restart simulation" : "Leave match"}
                </button>
              </>
            )}
            {modal === "pickup" && (
              <>
                <span className="eyebrow lime-text">FIELD SUPPLIES</span>
                <h2 id="modal-title">
                  {selected?.kind === "life"
                    ? "A second chance."
                    : selected
                      ? "A little pick-me-up."
                      : "Supply drop."}
                </h2>
                <p>
                  {selected
                    ? selected.kind === "med"
                      ? "Restore 40 HP, up to 100. One claim per pickup."
                      : "Carry one extra life. Storm depletion consumes it and restores 100 HP. Physical tags still convert you."
                    : "Select an available supply from the map."}
                </p>
                {selected && (
                  <>
                    <div className="pickup-instructions">
                      <MapPin size={24} />
                      <p>
                        Stand within <b>12 metres</b> of the marker. Two GPS
                        fixes <b>8–20 seconds apart</b>, each accurate to{" "}
                        <b>20 metres</b>, verify your claim. Stay inside the
                        safe circle.
                      </p>
                    </div>
                    {local && (
                      <button
                        className="secondary full"
                        onClick={() => {
                          if (!sim.current || !selected) return;
                          const p = sim.current.players[0];
                          const at = Date.now();
                          p.fix = {
                            x: selected.x,
                            y: selected.y,
                            at,
                            accuracy: 8,
                          };
                          p.previousFix = { ...p.fix, at: at - 10000 };
                          p.hp = Math.min(p.hp, 60);
                          update(view(sim.current, "you", at));
                          notify(
                            "Simulation: moved to pickup with two verified fixes",
                          );
                        }}
                      >
                        SIMULATE ARRIVAL
                      </button>
                    )}
                    <button
                      className="primary full"
                      disabled={busy || me.role !== "runner" || !active}
                      onClick={() => act("claim", { pickupId: selected.id })}
                    >
                      CLAIM {selected.kind === "med" ? "MED KIT" : "EXTRA LIFE"}{" "}
                      <ArrowDownLeft size={16} />
                    </button>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
