import { NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  clearedSessionCookieOptions,
  revokeSession,
} from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await revokeSession(request);
  } catch {
    // Clearing the browser cookie is still the important user-facing logout step.
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE_NAME, "", clearedSessionCookieOptions());
  return response;
}
