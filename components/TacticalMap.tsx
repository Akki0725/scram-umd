"use client";
import { useEffect, useRef, useState } from "react";
import {
  Crosshair,
  Layers,
  Minus,
  Plus,
  Navigation,
  Maximize2,
} from "lucide-react";
import {
  circle,
  toLngLat,
  CAMPUS_BOUNDARY,
  CAMPUS_ARENA,
  LANDMARKS,
  type Point,
} from "@/lib/geo";
import type { GameView, Pickup } from "@/lib/engine";
const XMIN = Math.min(...CAMPUS_BOUNDARY.map((p) => p.x)),
  XMAX = Math.max(...CAMPUS_BOUNDARY.map((p) => p.x));
const YMIN = Math.min(...CAMPUS_BOUNDARY.map((p) => p.y)),
  YMAX = Math.max(...CAMPUS_BOUNDARY.map((p) => p.y));
const camera = { x: (XMIN + XMAX) / 2, y: (YMIN + YMAX) / 2 };
const SCALE = Math.min(740 / (XMAX - XMIN), 490 / (YMAX - YMIN));
const px = (x: number) => 430 + (x - camera.x) * SCALE,
  py = (y: number) => 300 - (y - camera.y) * SCALE;
const path = (points: Point[]) =>
  points.map((p, i) => `${i ? "L" : "M"}${px(p.x)} ${py(p.y)}`).join(" ");
export default function TacticalMap({
  game,
  onPickup,
}: {
  game: GameView;
  onPickup: (p: Pickup) => void;
}) {
  const [street, setStreet] = useState(false),
    [zoom, setZoom] = useState(1),
    [loaded, setLoaded] = useState(false),
    [mapError, setMapError] = useState("");
  const el = useRef<HTMLDivElement>(null),
    map = useRef<import("maplibre-gl").Map | null>(null);
  const me = game.players.find((p) => p.id === game.you),
    z = game.zone,
    arena = game.arena || CAMPUS_ARENA;
  const pickups = game.pickups.filter((p) => !p.claimed);
  useEffect(() => {
    if (!street || !el.current) return;
    let alive = true;
    setLoaded(false);
    setMapError("");
    import("maplibre-gl").then(({ default: ml }) => {
      if (!alive || !el.current) return;
      try {
        const m = new ml.Map({
          container: el.current,
          center: toLngLat(camera),
          zoom: 14,
          minZoom: 12,
          maxZoom: 19,
          style: {
            version: 8,
            sources: {
              osm: {
                type: "raster",
                tiles: [
                  process.env.NEXT_PUBLIC_MAP_TILE_URL ||
                    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
                ],
                tileSize: 256,
                attribution:
                  process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ||
                  "© OpenStreetMap contributors",
              },
            },
            layers: [
              {
                id: "campus",
                type: "raster",
                source: "osm",
                paint: {
                  "raster-saturation": -0.8,
                  "raster-brightness-min": 0.08,
                  "raster-brightness-max": 0.65,
                },
              },
            ],
          },
        });
        map.current = m;
        m.on("load", () => {
          if (!alive) return;
          m.resize();
          const coords = CAMPUS_BOUNDARY.map(toLngLat);
          m.fitBounds(
            [
              [
                Math.min(...coords.map((p) => p[0])),
                Math.min(...coords.map((p) => p[1])),
              ],
              [
                Math.max(...coords.map((p) => p[0])),
                Math.max(...coords.map((p) => p[1])),
              ],
            ],
            { padding: 45, duration: 0 },
          );
          setLoaded(true);
        });
        m.on("error", () => {
          if (alive)
            setMapError(
              "Street tiles unavailable. Use tactical view for the match overlay.",
            );
        });
      } catch {
        setMapError(
          "This browser cannot render the street map. Tactical view is available.",
        );
        setStreet(false);
      }
    });
    return () => {
      alive = false;
      map.current?.remove();
      map.current = null;
    };
  }, [street]);
  useEffect(() => {
    const m = map.current;
    if (!street || !loaded || !m) return;
    const features: GeoJSON.Feature[] = [
      {
        type: "Feature",
        properties: { kind: "zone" },
        geometry: {
          type: "Polygon",
          coordinates: [circle(z.center, z.radius)],
        },
      },
      {
        type: "Feature",
        properties: { kind: "boundary" },
        geometry: {
          type: "Polygon",
          coordinates: [[...arena.boundary, arena.boundary[0]].map(toLngLat)],
        },
      },
      ...arena.exclusions.map((e) => ({
        type: "Feature" as const,
        properties: { kind: "exclusion" },
        geometry: {
          type: "Polygon" as const,
          coordinates: [circle(e.center, e.radius)],
        },
      })),
      ...(z.next
        ? [
            {
              type: "Feature" as const,
              properties: { kind: "next" },
              geometry: {
                type: "Polygon" as const,
                coordinates: [circle(z.next.center, z.next.radius)],
              },
            },
          ]
        : []),
      ...pickups.map((p) => ({
        type: "Feature" as const,
        properties: { kind: p.kind, id: p.id },
        geometry: { type: "Point" as const, coordinates: toLngLat(p) },
      })),
      ...game.pings.map((p) => ({
        type: "Feature" as const,
        properties: { kind: "runner" },
        geometry: { type: "Point" as const, coordinates: toLngLat(p) },
      })),
      ...(me?.fix
        ? [
            {
              type: "Feature" as const,
              properties: { kind: "you" },
              geometry: {
                type: "Point" as const,
                coordinates: toLngLat(me.fix),
              },
            },
          ]
        : []),
    ];
    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features,
    };
    const source = m.getSource("game") as
      import("maplibre-gl").GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
      return;
    }
    m.addSource("game", { type: "geojson", data });
    m.addLayer({
      id: "safe-fill",
      type: "fill",
      source: "game",
      filter: ["==", ["get", "kind"], "zone"],
      paint: { "fill-color": "#9c7ade", "fill-opacity": 0.1 },
    });
    m.addLayer({
      id: "borders",
      type: "line",
      source: "game",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "line-color": [
          "match",
          ["get", "kind"],
          "zone",
          "#bb91ff",
          "next",
          "#fff",
          "exclusion",
          "#ff8a69",
          "#c3ff43",
        ],
        "line-width": 2,
      },
    });
    m.addLayer({
      id: "points",
      type: "circle",
      source: "game",
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 8,
        "circle-color": [
          "match",
          ["get", "kind"],
          "you",
          "#c3ff43",
          "med",
          "#5dd7bb",
          "life",
          "#c19aff",
          "#ff9a78",
        ],
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 2,
      },
    });
  }, [game, loaded, street, arena, me, pickups, z]);
  return (
    <div className="map-shell">
      <div className="map-top">
        <span className="eyebrow">
          <span className="live-dot" /> UMD · CAMPUS-WIDE
        </span>
        <button className="map-style" onClick={() => setStreet((v) => !v)}>
          <Layers size={14} />
          {street ? "Street map" : "Tactical view"}
        </button>
      </div>
      {mapError && <p className="map-error">{mapError}</p>}
      <div ref={el} className={street ? "street-map" : "street-map hidden"} />
      {!street && (
        <svg
          className="tactical-map"
          viewBox="0 0 860 600"
          preserveAspectRatio="xMidYMid slice"
          role="group"
          aria-label="Campus-wide UMD tactical map with current circle and revealed next pull"
        >
          <defs>
            <pattern
              id="grid"
              width="30"
              height="30"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M30 0H0V30"
                fill="none"
                stroke="#31414b"
                strokeWidth=".5"
              />
            </pattern>
            <pattern
              id="storm"
              width="10"
              height="10"
              patternTransform="rotate(35)"
              patternUnits="userSpaceOnUse"
            >
              <path d="M0 0V10" stroke="#ad8be9" strokeWidth="1" opacity=".2" />
            </pattern>
            <mask id="outside">
              <rect width="860" height="600" fill="white" />
              <circle
                cx={px(z.center.x)}
                cy={py(z.center.y)}
                r={z.radius * SCALE}
                fill="black"
              />
            </mask>
          </defs>
          <rect width="860" height="600" fill="#121e25" />
          <rect width="860" height="600" fill="url(#grid)" />
          <g
            transform={`translate(430 300) scale(${zoom}) translate(-430 -300)`}
          >
            <path
              d={path(CAMPUS_BOUNDARY) + "Z"}
              fill="#22382f"
              fillOpacity=".5"
              stroke="#8ba96e"
              strokeOpacity=".6"
              strokeDasharray="4 5"
            />
            <text x={px(-320)} y={py(1500)} className="campus-region-label">
              NORTH CAMPUS
            </text>
            <text x={px(-520)} y={py(-420)} className="campus-region-label">
              SOUTH CAMPUS
            </text>
            <g stroke="#546358" fill="none" strokeWidth="5" opacity=".5">
              <path
                d={path([
                  { x: -1000, y: 260 },
                  { x: -400, y: 250 },
                  { x: 100, y: 300 },
                  { x: 650, y: 260 },
                ])}
              />
              <path
                d={path([
                  { x: -680, y: -600 },
                  { x: -600, y: 100 },
                  { x: -420, y: 500 },
                  { x: -300, y: 1200 },
                  { x: 100, y: 1500 },
                ])}
              />
              <path
                d={path([
                  { x: 550, y: -650 },
                  { x: 600, y: 200 },
                  { x: 480, y: 950 },
                  { x: 400, y: 1550 },
                ])}
              />
            </g>
            {LANDMARKS.map((p, i) => (
              <g key={p.name} transform={`translate(${px(p.x)} ${py(p.y)})`}>
                <rect
                  x="-18"
                  y="-12"
                  width="36"
                  height="24"
                  rx="3"
                  fill="#2a3c40"
                  stroke="#4b6265"
                />
                <circle r="3" fill="#91ab84" />
                <text
                  className="campus-landmark"
                  x={i % 2 ? 25 : -25}
                  y="-7"
                  textAnchor={i % 2 ? "start" : "end"}
                >
                  {p.name.split(" · ")[0]}
                </text>
              </g>
            ))}
            {arena.exclusions.map((e, i) => (
              <circle
                key={i}
                cx={px(e.center.x)}
                cy={py(e.center.y)}
                r={Math.max(3, e.radius * SCALE)}
                fill="#50362c"
                stroke="#d78a6d"
              />
            ))}
            <rect
              width="860"
              height="600"
              fill="#7750a9"
              fillOpacity=".22"
              mask="url(#outside)"
            />
            <rect
              width="860"
              height="600"
              fill="url(#storm)"
              mask="url(#outside)"
            />
            <circle
              cx={px(z.center.x)}
              cy={py(z.center.y)}
              r={z.radius * SCALE}
              fill="#c3ff43"
              fillOpacity=".025"
              stroke="#c4a1ff"
              strokeWidth="2"
            />
            {z.next && (
              <circle
                className="next-zone"
                cx={px(z.next.center.x)}
                cy={py(z.next.center.y)}
                r={z.next.radius * SCALE}
                fill="none"
                stroke="white"
                strokeWidth="1.5"
                strokeDasharray="7 7"
              />
            )}
            {pickups.map((p) => (
              <g
                key={p.id}
                role="button"
                tabIndex={0}
                aria-label={
                  p.kind === "med" ? "Select med kit" : "Select extra life"
                }
                className="svg-pickup"
                onClick={() => onPickup(p)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onPickup(p);
                }}
                transform={`translate(${px(p.x)} ${py(p.y)})`}
              >
                <rect
                  x="-11"
                  y="-11"
                  width="22"
                  height="22"
                  rx="6"
                  fill={p.kind === "med" ? "#244c45" : "#47355c"}
                  stroke={p.kind === "med" ? "#58e5bd" : "#c09aff"}
                />
                <text textAnchor="middle" y="5" fill="white" fontSize="17">
                  {p.kind === "med" ? "+" : "✦"}
                </text>
              </g>
            ))}
            {game.pings.map((p) => (
              <g key={p.id} transform={`translate(${px(p.x)} ${py(p.y)})`}>
                <circle
                  r="13"
                  fill="#ff987a"
                  fillOpacity=".18"
                  stroke="#ff987a"
                  strokeDasharray="2 3"
                />
                <circle r="4" fill="#ff987a" />
                <text y="-19" textAnchor="middle" fill="#ffb59a" fontSize="10">
                  {p.name}
                </text>
              </g>
            ))}
            {me?.fix && (
              <g transform={`translate(${px(me.fix.x)} ${py(me.fix.y)})`}>
                <circle
                  className="player-pulse"
                  r="20"
                  fill="#c3ff43"
                  opacity=".15"
                />
                <circle r="9" fill="#c3ff43" stroke="#1e3025" strokeWidth="3" />
                <path d="M0 -5L4 4L0 2L-4 4Z" fill="#16251c" />
                <rect
                  x="-18"
                  y="-34"
                  width="36"
                  height="18"
                  rx="4"
                  fill="#c3ff43"
                />
                <text
                  textAnchor="middle"
                  y="-22"
                  fill="#16251c"
                  fontSize="9"
                  fontWeight="900"
                >
                  YOU
                </text>
              </g>
            )}
          </g>
        </svg>
      )}
      <div className="map-compass">
        <span>N</span>
        <Navigation size={20} />
      </div>
      <div className="map-controls">
        <button
          aria-label="Zoom in"
          onClick={() =>
            street
              ? map.current?.zoomIn()
              : setZoom((v) => Math.min(4, v + 0.3))
          }
        >
          <Plus size={18} />
        </button>
        <button
          aria-label="Zoom out"
          onClick={() =>
            street
              ? map.current?.zoomOut()
              : setZoom((v) => Math.max(0.7, v - 0.3))
          }
        >
          <Minus size={18} />
        </button>
        <button
          aria-label="Center on me"
          onClick={() => {
            setZoom(1);
            map.current?.flyTo({
              center: toLngLat(me?.fix || z.center),
              zoom: 15,
            });
          }}
        >
          <Crosshair size={18} />
        </button>
      </div>
      <div className="map-bottom">
        <span>
          {street ? "© OpenStreetMap" : "CAMPUS SCHEMATIC · NOT FOR NAVIGATION"}
        </span>
        <span>
          <Maximize2 size={11} />
          {Math.round(z.radius * 2).toLocaleString()} m CIRCLE
        </span>
      </div>
      <div className="map-legend">
        <span>
          <i className="lime" />
          You
        </span>
        <span>
          <i className="purple" />
          Storm
        </span>
        <span>
          <i className="white" />
          Next pull
        </span>
        <span>
          <i className="teal" />
          Pickup
        </span>
      </div>
    </div>
  );
}
