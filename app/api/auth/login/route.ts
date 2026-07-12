import { NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  loginWithPassword,
  sessionCookieOptions,
} from "@/lib/server/auth";
import { clientIpFromRequest, rateLimit, rateLimitResponse } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const ip = clientIpFromRequest(request);
    const body = (await request.json()) as {
      email?: unknown;
      password?: unknown;
    };
    const emailKey = String(body.email ?? "").trim().toLowerCase() || "unknown";
    const limited = rateLimit({
      key: `auth:login:${ip}:${emailKey}`,
      limit: 8,
      windowMs: 15 * 60 * 1000,
    });
    if (!limited.ok) return rateLimitResponse(limited);

    const result = await loginWithPassword({
      email: body.email,
      password: body.password,
      request,
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, reason: result.reason },
        { status: result.status },
      );
    }

    const response = NextResponse.json({ ok: true, user: result.user });
    response.cookies.set(
      AUTH_COOKIE_NAME,
      result.token,
      sessionCookieOptions(result.expiresAt),
    );
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        reason: error instanceof Error ? error.message : "Could not sign in.",
      },
      { status: 500 },
    );
  }
}
