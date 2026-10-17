# SCRAM ↗

A mobile-first UMD outdoor hide-and-seek MVP. Next.js 16 / React / TypeScript, Supabase Postgres + Auth + Realtime, and MapLibre. The default map needs no API key. Original tactical styling inspired by battle royale games; no Fortnite assets.

## Run the local simulation

Requires Node 20.19+ and npm. From this folder:

```sh
npm ci
npm run dev
```

Open http://localhost:3000. No environment variables are needed. This mode uses synthetic players and coordinates in your browser, has a prominent **LOCAL SIMULATION** label, and never requests actual GPS. It does not connect multiple people. Use Squad to switch roles, and a supply card → Simulate Arrival → Claim to exercise pickups. Use “I was tagged” to test infection. Refresh restarts the simulation.

## Enable real multiplayer

1. Create a Supabase project. In Authentication → Providers, enable **Anonymous Sign-Ins**. Players receive an anonymous authenticated identity; no email or password is needed. Clear browser data and you lose that identity. Protect signups with Supabase authentication rate limits and a deployment edge rate limiter before opening access beyond a trusted pilot.
2. Enable **pg_cron** under Database → Extensions. Run `supabase/migrations/001_scram.sql` followed by `supabase/migrations/002_database_clock.sql` in the SQL editor (or use the Supabase CLI migrations workflow). It creates private state, memberships, revision-only realtime signals, atomic writes, durable rate buckets, worker health, and a cleanup schedule. It adds only the signal table to the Realtime publication. Do not publish the state table or add permissive policies.
3. Copy `.env.example` to `.env.local`. Set the project URL, public anon key, and **server-only** service-role key. The service key must never be exposed in client variables, URLs, logs, or Git. Next.js reads `.env.local`; restart after changes.
4. An organizer must physically inspect the candidate area in `lib/geo.ts`, check campus permission/access/current conditions, and correct coordinates and exclusions as needed. Set `APPROVED_PLAY_AREA=true` **only after this check**. This code does not claim university approval or independently verified safety.
5. Start the web app. The second migration schedules a once-per-second authoritative match clock inside Supabase, with no extra worker hosting required. The server refuses to start a match unless its clock heartbeat is recent. `npm run worker` remains an optional alternative for a self-hosted database; do not run both clocks in normal operation.
6. Open “Play with friends”, choose a display name, create a lobby, and share its link. Use 3–20 distinct browser/device sessions. Players must explicitly enable GPS, be inside the approved footprint, have a fix ≤35 m accuracy and ≤30 seconds old, and mark ready. The host checks the safety briefing box and starts.
7. Phones require an **HTTPS** origin for GPS. `localhost` is allowed only on that same device. A phone visiting a computer’s plain HTTP LAN address generally cannot use GPS. Deploy HTTPS for a campus pilot.

## Deployment

Deploy the web app on Vercel or another Node-compatible Next.js host: install `npm ci`, build `npm run build`, start `npm start`. Add all four environment variables, rebuild, and use the HTTPS URL. The second migration runs the authoritative match clock inside Supabase using pg_cron every second; Vercel only serves the web app and authenticated actions. No Vercel cron, long-running serverless function, or third hosting service is required. Scope the deployment to your private pilot; there is no public directory of lobbies.

This delivery includes a verified localhost preview. Deployment is configured against the dedicated SCRAM-UMD Supabase project. Secrets live only in ignored local environment settings and deployment settings. `APPROVED_PLAY_AREA` stays false until an organizer verifies the outdoor geometry. Real-phone field verification remains required before play.

## Rules implemented

- Max 20; min 3 to start. Fisher–Yates random teams, `ceil(players × .25)` hunters. Server uses cryptographic random integers.
- Two-minute head start. First runner snapshot at release, subsequent snapshots every 60 seconds. All runners with fresh fixes are included; missing-fix runners cannot be honestly located and are omitted. Positions snap to a 40 m grid, remain frozen until the next ping, and are available only to current hunters. Grid quantization is approximate disclosure, **not** an anonymity guarantee.
- Runner confirms a real gentle physical tag → hunter. No hunter can force a tag. A dishonest self-report cannot be verified by browser GPS.
- 100 HP. Safe circle changes every 5 minutes; next circle is revealed 2 minutes before closing. Six circle sizes, with DPS `1, 2, 5, 8, 10, 10`. Outside the approved footprint (including central exclusion) also causes damage. Hunters take no damage.
- Randomized final west/east lawn centers within a deliberately small **candidate** McKeldin Mall footprint. Circles are nested; playable space is always the intersection with the footprint. This pilot avoids designing a route across campus streets. It is not a campus-wide rollout; expansion requires reviewed walking corridors and exclusion geometry.
- Med kits heal 40 HP, capped at 100. Extra life is carried at most once and automatically restores 100 HP on storm depletion, consuming itself. It never cancels a physical tag. Both teams see unclaimed supplies, but only runners can claim/use them.
- Pickup claim needs two server-received fixes 8–20 seconds apart, ≤20 m reported accuracy, within 12 m of the pickup; latest fix ≤10 seconds old; claimant and pickup in safe zone. One atomic claim wins a race. Claimed items never respawn. There is no automatic pickup.
- Last remaining runner wins. Simultaneous depletion may produce no survivor. A 40-minute limit produces a draw if multiple runners remain. Host can end the match without declaring a winner. No rematch in the same lobby; create a fresh code.
- Disconnects get 45 seconds of location grace. Missing/poor GPS then counts as outside, applying the current storm damage until a valid location resumes. Clock time never pauses. Reopening the same browser restores membership while its anonymous session remains. Active leavers forfeit participation and stop receiving match information; host transfers to the next participant.

## Authority, privacy and abuse controls

- `lib/engine.ts` is the shared deterministic rules engine, but only the Next.js server and hosted database clock can persist real games. Client actions never set HP, roles, timestamps, storm phase, or winners. Browser simulation imports the same rules without database credentials.
- `scram_commit` uses versioned compare-and-swap in Postgres and atomically updates state, membership, and revision signals. Conflicts re-read and revalidate up to eight times, so pickup/join races cannot overwrite state. Every write RPC is revoked from `PUBLIC`, `anon`, and `authenticated`; only `service_role` can execute.
- Exact GPS is in an RLS-protected table with no client grants. REST responses disclose only the requester’s fix; hunters get authorized frozen snapshots. Future final coordinates are omitted. Realtime transmits **only match ID and revision**, with membership RLS, then clients retrieve a filtered view through the server. Three-second polling is the fallback. No coordinates are placed in realtime payloads.
- Locations are cleared immediately when the match finishes or ends; departing players are removed and membership revoked. `pg_cron` purges entire matches after one hour, including abandoned waiting rooms, even when the web/worker service is offline. The API also rejects expired matches. This is application-level erasure: database backups, platform logs and auth-account retention follow your provider’s settings. Anonymous auth users are not automatically deleted.
- GPS is opt-in, clearly shown, can be stopped, and is cleared from the watch on leave/end. No service worker or background location tracking. Locked/mobile background browsers may suspend GPS and timers; keep the page visible and unlocked. Reconnect retrieves authoritative state.
- Durable per-user limits: 100 API requests/minute, 12 join attempts/minute, 3 lobby creations/hour. Auth token is verified server-side on each request. Mutations require same origin, bounded validated fields and membership. Display names are rendered as text. Lobby codes use 8 random unambiguous characters, not a public index.
- Freshness/accuracy checks, 10-second GPS sampling, and a maximum plausible movement envelope reject obvious teleports. **Web GPS is self-reported and can be spoofed**. A coordinated cheat, fake browser accuracy, dishonest tag or colluding player is outside what this MVP can establish. No invasive location fingerprinting. Supervise trusted-group pilots.
- Anonymous identities can be regenerated to evade per-user limits. Set edge/IP rate limits for `/api/game` and Supabase signups, request-size limits, spending caps, and monitoring before broader access. CAPTCHA integration is not included; enabling a CAPTCHA requirement in Supabase alone will prevent anonymous login until you wire its token into the client.
- The street-map view loads OpenStreetMap raster tiles. Attribution is included; set `NEXT_PUBLIC_MAP_TILE_URL` and `NEXT_PUBLIC_MAP_ATTRIBUTION` to a production tile provider for larger traffic. The default follows the [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/), uses browser caching, and sends an origin-only cross-origin referrer. The default offline-friendly SVG is a geographic **schematic**, not a walking navigation product. No third-party map receives a separate player-coordinate API call, though map viewport requests can imply the viewed area.

## Code map

- `components/Game.tsx`: lobby, map, HUD, GPS consent, squad, pickups, tag confirmation, results and reconnect.
- `components/TacticalMap.tsx`: local tactical schematic plus optional MapLibre street map.
- `lib/engine.ts`: match authority and per-player disclosure.
- `lib/server.ts`: authenticated persistence, CAS retries and rate limits.
- `app/api/game/route.ts`: validated lobby/action endpoint.
- `supabase/migrations/002_database_clock.sql`: hosted authoritative match clock (pg_cron), tested for parity with the TypeScript engine.
- `scripts/worker.ts`: optional Node clock for deployments that do not use the hosted database clock.
- `supabase/migrations/001_scram.sql`: RLS, tables, functions, publication and privacy cleanup.

## Verification

```sh
npm test
npm run typecheck
npm run build
```

The included rule suite covers all lobby sizes, readiness, head start, tags, frozen pings, role-specific disclosure, zone secrecy, storm catch-up/idempotency, extra lives, pickup verification, stale/spoof-like fixes, disconnect conversion, winner/draw logic, leave/revocation, nested zones and coordinate projection. The embedded PostgreSQL test also executes the migration (excluding Supabase Realtime publication and pg_cron setup), checks version conflicts, denied state reads/RPC writes, tenant membership RLS, revocation and durable rate limits. This is not a live Supabase or field test. `npm run test:integration` adds opt-in database checks; inject the Supabase environment variables and set `SCRAM_INTEGRATION_CONFIRM=disposable` only for a disposable project. It creates two anonymous test users and its own match, then deletes those fixtures. With the gate unset it explicitly skips.

Before a pilot: run the integration checks on a disposable test project, then use multiple actual phones over HTTPS to verify joining, private realtime, GPS accuracy, pickup contention, locked-phone behavior, network loss, worker outage/catch-up, end-of-match location clearing, and the cleanup job. Indoor GPS behavior is not proof of outdoor accuracy. Test the organizer-approved geometry on foot.

Official references: [Supabase anonymous auth](https://supabase.com/docs/guides/auth/auth-anonymous), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Next.js route handlers](https://nextjs.org/docs/app/getting-started/route-handlers), [UMD campus map](https://maps.umd.edu/map/m/). The UMD map is a reference, not approval for this game.
