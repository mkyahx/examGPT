import { getCurrentUser } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser(request);
    return Response.json({ ok: true, authenticated: Boolean(user), user });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        authenticated: false,
        user: null,
        reason: error instanceof Error ? error.message : "Could not load session.",
      },
      { status: 500 },
    );
  }
}
