import { chatgptSessions, requireLocal } from "@/lib/chatgpt-session.server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    requireLocal(request, false, true);
  } catch {
    return new Response(
      "Open this callback on the configured local LoopPilot server.",
      { status: 403 },
    );
  }
  const browser =
    (request.headers.get("cookie") ?? "")
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("looppilot-oauth="))
      ?.slice("looppilot-oauth=".length) ?? "";
  let success = true;
  try {
    if (!browser) throw new Error("Missing browser binding.");
    await chatgptSessions.callback(new URL(request.url).searchParams, browser);
  } catch {
    success = false;
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: `/settings?chatgpt=${success ? "connected" : "failed"}`,
      "Set-Cookie":
        "looppilot-oauth=; HttpOnly; SameSite=Lax; Path=/auth/callback; Max-Age=0",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
