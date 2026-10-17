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
import { circle, toLngLat } from "@/lib/geo";
import type { GameView, Pickup } from "@/lib/engine";
export default function TacticalMap({
  game,
  onPickup,
}: {
  game: GameView;
  onPickup: (p: Pickup) => void;
}) {
  const [street, setStreet] = useState(false),
    [zoom, setZoom] = useState(1);
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<import("maplibre-gl").Map | null>(null);
  const me = game.players.find((p) => p.id === game.you),
    z = game.zone;
  useEffect(() => {
    if (!street || !el.current) return;
    let alive = true;
    import("maplibre-gl").then(({ default: ml }) => {
      if (!alive || !el.current) return;
      const m = new ml.Map({
        container: el.current,
        center: toLngLat({ x: 0, y: 0 }),
        zoom: 16.8,
        minZoom: 14,
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
                "raster-saturation": -1,
                "raster-brightness-min": 0.08,
                "raster-brightness-max": 0.65,
              },
            },
          ],
        },
      });
      map.current = m;
      m.on("error", () => {});
      m.on("load", () => {
        m.resize();
      });
    });
    return () => {
      alive = false;
      map.current?.remove();
      map.current = null;
    };
  }, [street]);
  useEffect(() => {
    if (!street) return;
    const m = map.current;
    if (!m) return;
    const render = () => {
      if (!m.isStyleLoaded()) return;
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
            coordinates: [
              [
                ...[
                  { x: -140, y: -30 },
                  { x: 140, y: -30 },
                  { x: 140, y: 30 },
                  { x: -140, y: 30 },
                  { x: -140, y: -30 },
                ].map(toLngLat),
              ],
            ],
          },
        },
        {
          type: "Feature",
          properties: { kind: "exclusion" },
          geometry: {
            type: "Polygon",
            coordinates: [circle({ x: 0, y: 0 }, 18)],
          },
        },
        ...(z.preview && z.next
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
        ...game.pickups
          .filter((p) => !p.claimed)
          .map((p) => ({
            type: "Feature" as const,
            properties: { kind: p.kind },
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
        id: "zone",
        type: "fill",
        source: "game",
        filter: ["==", ["get", "kind"], "zone"],
        paint: { "fill-color": "#9364ed", "fill-opacity": 0.12 },
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
            "#b794ff",
            "next",
            "#ffffff",
            "exclusion",
            "#ff755a",
            "#c2ff44",
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
            "#c2ff44",
            "med",
            "#48dec2",
            "life",
            "#c09aff",
            "#ff8d63",
          ],
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 2,
        },
      });
    };
    render();
    m.on("load", render);
    return () => {
      m.off("load", render);
    };
  }, [game, me, street, z]);
  const px = (x: number) => 430 + x * 1.6,
    py = (y: number) => 300 - y * 1.6;
  const pickups = game.pickups.filter((p) => !p.claimed);
  return (
    <div className="map-shell">
      <div className="map-top">
        <span className="eyebrow">
          <span className="live-dot" /> UMD · COLLEGE PARK
        </span>
        <button className="map-style" onClick={() => setStreet((v) => !v)}>
          <Layers size={14} />
          {street ? "Street map" : "Tactical view"}
        </button>
      </div>
      <div ref={el} className={street ? "street-map" : "street-map hidden"} />
      {!street && (
        <svg
          className="tactical-map"
          viewBox="0 0 860 600"
          role="group"
          aria-label="Tactical schematic of the candidate McKeldin Mall play area, storm and pickups"
        >
          <defs>
            <pattern
              id="grid"
              width="36"
              height="36"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 36 0 L 0 0 0 36"
                fill="none"
                stroke="#2c3543"
                strokeWidth=".5"
              />
            </pattern>
            <pattern
              id="storm"
              width="12"
              height="12"
              patternTransform="rotate(35)"
              patternUnits="userSpaceOnUse"
            >
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="12"
                stroke="#9671d8"
                strokeWidth="1"
                opacity=".22"
              />
            </pattern>
            <radialGradient id="glow">
              <stop stopColor="#435746" stopOpacity=".3" />
              <stop offset="1" stopColor="#19252a" stopOpacity="0" />
            </radialGradient>
            <mask id="outside">
              <rect width="860" height="600" fill="white" />
              <circle
                cx={px(z.center.x)}
                cy={py(z.center.y)}
                r={z.radius * 1.6}
                fill="black"
              />
            </mask>
            <filter id="soft">
              <feGaussianBlur stdDeviation="5" />
            </filter>
          </defs>
          <rect width="860" height="600" fill="#131c23" />
          <rect width="860" height="600" fill="url(#grid)" />
          <g
            transform={`translate(430 300) scale(${zoom}) translate(-430 -300)`}
          >
            <rect width="860" height="600" fill="url(#glow)" />
            <g fill="#202b34" stroke="#36424a" strokeWidth="1">
              <path d="M90 132h130v75H90z M95 393h125v72H95z M281 107h106v76H281z M292 420h115v65H292z M481 105h115v80H481z M481 425h110v62H481z M659 146h115v87H659z M672 373h100v90H672z M26 264h145v82H26z M706 265h125v68H706z" />
              <path d="M34 104h47v118H34z M320 32h88v37H320z M460 519h133v42H460z M786 122h50v102H786z" />
            </g>
            <g fill="none" strokeLinecap="round">
              <path
                d="M-10 228C180 250 258 238 430 220S690 226 880 249 M-10 377C190 345 252 368 430 383S688 367 880 355"
                stroke="#314047"
                strokeWidth="16"
              />
              <path
                d="M239 -10L238 182Q205 300 245 410L256 620 M632 -10L625 185Q667 300 633 421L639 620"
                stroke="#344249"
                strokeWidth="12"
              />
              <path
                d="M210 300H665 M245 250L627 350 M245 350L627 250"
                stroke="#55604d"
                strokeWidth="5"
              />
            </g>
            <path
              d="M206 252H654V348H206Z"
              fill="#3b503a"
              fillOpacity=".24"
              stroke="#a8be6b"
              strokeDasharray="4 6"
              strokeOpacity=".5"
            />
            <circle
              cx="430"
              cy="300"
              r="29"
              fill="#19252a"
              stroke="#af7963"
              strokeDasharray="3 4"
            />
            <circle cx="430" cy="300" r="12" fill="#30444b" />
            <g className="map-labels">
              <text x="74" y="253">
                MCKELDIN
              </text>
              <text x="80" y="269">
                LIBRARY
              </text>
              <text x="314" y="98">
                TYDINGS HALL
              </text>
              <text x="484" y="96">
                KEY HALL
              </text>
              <text x="705" y="252">
                MAIN
              </text>
              <text x="695" y="268">
                ADMINISTRATION
              </text>
              <text x="300" y="510">
                WOODS HALL
              </text>
              <text x="483" y="507">
                FRANCIS SCOTT KEY
              </text>
              <text className="mall-label" x="355" y="322">
                MCKELDIN MALL
              </text>
              <text x="302" y="214">
                CANDIDATE OUTDOOR BOUNDARY
              </text>
            </g>
            <rect
              width="860"
              height="600"
              fill="#7453a8"
              opacity=".19"
              mask="url(#outside)"
            />
            <rect
              width="860"
              height="600"
              fill="url(#storm)"
              mask="url(#outside)"
            />
            <circle
              className="storm-blur"
              cx={px(z.center.x)}
              cy={py(z.center.y)}
              r={z.radius * 1.6}
              fill="none"
              stroke="#9a77ed"
              strokeWidth="8"
              opacity=".2"
              filter="url(#soft)"
            />
            <circle
              cx={px(z.center.x)}
              cy={py(z.center.y)}
              r={z.radius * 1.6}
              fill="none"
              stroke="#b38af7"
              strokeWidth="2"
            />
            {z.preview && z.next && (
              <circle
                className="next-zone"
                cx={px(z.next.center.x)}
                cy={py(z.next.center.y)}
                r={z.next.radius * 1.6}
                fill="none"
                stroke="#e5ecdb"
                strokeWidth="1.5"
                strokeDasharray="7 7"
              />
            )}
            {pickups.map((p) => (
              <g
                key={p.id}
                onClick={() => onPickup(p)}
                className="svg-pickup"
                role="button"
                tabIndex={0}
                aria-label={
                  p.kind === "med" ? "Select med kit" : "Select extra life"
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onPickup(p);
                }}
                transform={`translate(${px(p.x)} ${py(p.y)})`}
              >
                <rect
                  x="-15"
                  y="-15"
                  width="30"
                  height="30"
                  rx="8"
                  fill={p.kind === "med" ? "#244c45" : "#47355c"}
                  stroke={p.kind === "med" ? "#58e5bd" : "#b38af7"}
                />
                <text
                  textAnchor="middle"
                  y="6"
                  fill={p.kind === "med" ? "#76f2d3" : "#dfc1ff"}
                  fontSize="22"
                  fontWeight="800"
                >
                  {p.kind === "med" ? "+" : "✦"}
                </text>
              </g>
            ))}
            {game.pings.map((p) => (
              <g key={p.id} transform={`translate(${px(p.x)} ${py(p.y)})`}>
                <circle
                  r="26"
                  fill="#ff987a"
                  opacity=".12"
                  stroke="#ff987a"
                  strokeDasharray="2 3"
                />
                <circle r="6" fill="#ff987a" />
                <text y="-32" textAnchor="middle" fill="#ffb59a" fontSize="11">
                  {p.name}
                </text>
              </g>
            ))}
            {me?.fix && (
              <g transform={`translate(${px(me.fix.x)} ${py(me.fix.y)})`}>
                <circle
                  className="player-pulse"
                  r="24"
                  fill="#c5ff43"
                  opacity=".12"
                />
                <circle
                  r="12"
                  fill="#c5ff43"
                  stroke="#17231e"
                  strokeWidth="4"
                />
                <path d="M0 -6L5 5L0 2L-5 5Z" fill="#17231e" />
                <rect
                  x="-21"
                  y="-40"
                  width="42"
                  height="20"
                  rx="4"
                  fill="#c5ff43"
                />
                <text
                  y="-26"
                  textAnchor="middle"
                  fill="#17231e"
                  fontSize="10"
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
              : setZoom((v) => Math.min(2, v + 0.2))
          }
        >
          <Plus size={18} />
        </button>
        <button
          aria-label="Zoom out"
          onClick={() =>
            street
              ? map.current?.zoomOut()
              : setZoom((v) => Math.max(0.6, v - 0.2))
          }
        >
          <Minus size={18} />
        </button>
        <button
          aria-label="Center on me"
          onClick={() => {
            setZoom(1);
            map.current?.flyTo({
              center: toLngLat(me?.fix || { x: 0, y: 0 }),
              zoom: 17,
            });
          }}
        >
          <Crosshair size={18} />
        </button>
      </div>
      <div className="map-bottom">
        <span>
          {street
            ? "© OpenStreetMap"
            : "GEOGRAPHIC SCHEMATIC · NOT FOR NAVIGATION"}
        </span>
        <span>
          <Maximize2 size={11} />{" "}
          {street ? "Outdoor boundary in lime" : "50 m ━━━"}
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
          Next zone
        </span>
        <span>
          <i className="teal" />
          Pickup
        </span>
      </div>
    </div>
  );
}
