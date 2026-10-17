import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authenticate,
  limit,
  newLobby,
  mutate,
  advance,
  read,
  db,
} from "@/lib/server";
import { view } from "@/lib/engine";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({
  code: z
    .string()
    .regex(/^[A-Z2-9]{8}$/)
    .optional(),
  type: z.enum([
    "create",
    "join",
    "ready",
    "start",
    "location",
    "tag",
    "claim",
    "leave",
    "end",
    "heartbeat",
  ]),
  name: z.string().trim().min(1).max(18).optional(),
  approved: z.boolean().optional(),
  pickupId: z.string().max(40).optional(),
  fix: z
    .object({
      x: z.number().finite().min(-10000).max(10000),
      y: z.number().finite().min(-10000).max(10000),
      at: z.number().finite(),
      accuracy: z.number().finite().min(0).max(35),
    })
    .optional(),
});
function json(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store, private" },
  });
}
function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : "Request failed";
  const status = /Too many/.test(msg)
    ? 429
    : /Sign in|Session expired/.test(msg)
      ? 401
      : /not in/.test(msg)
        ? 403
        : /not configured/.test(msg)
          ? 503
          : 400;
  return json({ error: msg }, status);
}
export async function GET(req: NextRequest) {
  try {
    const uid = await authenticate(req.headers.get("authorization"));
    await limit("api:" + uid, 100, 60);
    const code = req.nextUrl.searchParams.get("code") || "";
    if (!/^[A-Z2-9]{8}$/.test(code)) throw Error("Invalid lobby code");
    const { state } = await read(code);
    if (!state.players.some((p) => p.id === uid))
      throw Error("You are not in this lobby");
    return json(view(await advance(code), uid, Date.now()));
  } catch (e) {
    return fail(e);
  }
}
async function body(req: NextRequest) {
  const reader = req.body?.getReader();
  if (!reader) throw Error("A request body is required");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 4096) {
      await reader.cancel();
      throw Error("Request is too large");
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(joined));
}
export async function POST(req: NextRequest) {
  try {
    if (req.headers.get("origin") !== req.nextUrl.origin)
      throw Error("Invalid request origin");
    if (Number(req.headers.get("content-length") || 0) > 4096)
      throw Error("Request is too large");
    const uid = await authenticate(req.headers.get("authorization"));
    await limit("api:" + uid, 100, 60);
    const data = schema.parse(await body(req));
    if (data.type === "create")
      return json(
        view(await newLobby(uid, data.name || "Player"), uid, Date.now()),
      );
    if (!data.code) throw Error("A lobby code is required");
    if (data.type === "join") await limit("join:" + uid, 12, 60);
    if (data.type === "start") {
      if (process.env.APPROVED_PLAY_AREA !== "true")
        throw Error(
          "Organizer must verify the outdoor boundary and enable APPROVED_PLAY_AREA on the server",
        );
      const { data } = await db()
        .from("scram_worker")
        .select("at")
        .eq("id", 1)
        .single();
      if (!data || Date.now() - Date.parse(data.at) > 10000)
        throw Error("Match worker is offline. Ask the organizer to start it");
    }
    const m = await mutate(data.code, uid, data);
    if (data.type === "leave") return json({ left: true });
    return json(view(m, uid, Date.now()));
  } catch (e) {
    return fail(e);
  }
}
