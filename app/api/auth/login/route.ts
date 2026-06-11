import { NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  loginWithPassword,
  sessionCookieOptions,
} from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      email?: unknown;
      password?: unknown;
    };
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
