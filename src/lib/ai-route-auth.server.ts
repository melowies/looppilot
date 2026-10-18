import { createClient } from "@supabase/supabase-js";
import { ChatGPTError } from "./chatgpt-protocol.server";

export async function authenticatedAIUser(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization = request.headers.get("authorization") ?? "";
  if (!url || !key || !authorization.startsWith("Bearer "))
    throw new ChatGPTError(
      "unauthenticated",
      "Sign in to LoopPilot first.",
      401,
    );
  const db = createClient(url, key, {
    global: { headers: { Authorization: authorization } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const {
    data: { user },
    error,
  } = await db.auth.getUser(authorization.slice(7));
  if (error || !user)
    throw new ChatGPTError(
      "unauthenticated",
      "Sign in to LoopPilot first.",
      401,
    );
  return { user, db };
}
