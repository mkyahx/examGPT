import { NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  registerWithPassword,
  sessionCookieOptions,
} from "@/lib/server/auth";
import { clientIpFromRequest, rateLimit, rateLimitResponse } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const ip = clientIpFromRequest(request);
    const limited = rateLimit({
      key: `auth:register:${ip}`,
      limit: 5,
      windowMs: 60 * 60 * 1000,
    });
    if (!limited.ok) return rateLimitResponse(limited);

    const body = (await request.json()) as {
      email?: unknown;
      displayName?: unknown;
      password?: unknown;
    };
    const result = await registerWithPassword({
      email: body.email,
      displayName: body.displayName,
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
        reason: error instanceof Error ? error.message : "Could not create account.",
      },
      { status: 500 },
    );
  }
}
