import { createClient } from "@supabase/supabase-js";
export const configured =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const supabase =
  configured && typeof window !== "undefined"
    ? createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      )
    : null;
export async function token() {
  if (!supabase) throw Error("Configure Supabase to enable multiplayer");
  let {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    const result = await supabase.auth.signInAnonymously();
    if (result.error) throw result.error;
    session = result.data.session;
  }
  if (!session) throw Error("Could not sign in");
  return session.access_token;
}
export async function request(
  code: string,
  type?: string,
  extra: Record<string, unknown> = {},
) {
  const auth = await token();
  const res = await fetch(
    type ? "/api/game" : `/api/game?code=${encodeURIComponent(code)}`,
    {
      method: type ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${auth}`,
        ...(type ? { "Content-Type": "application/json" } : {}),
      },
      ...(type
        ? { body: JSON.stringify({ code: code || undefined, type, ...extra }) }
        : {}),
    },
  );
  const data = await res.json();
  if (!res.ok) throw Error(data.error || "Connection failed");
  return data;
}
