import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { supabaseRest } from "@/lib/server/supabaseRest";
import type { AuthUser } from "@/lib/types";

export const AUTH_COOKIE_NAME = "examgpt_session";

const SESSION_DAYS = 30;
const PASSWORD_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = {
  N: 16384,
  r: 8,
  p: 1,
} as const;

type AppUserRow = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  role: AuthUser["role"];
  created_at: string;
  last_login_at: string | null;
};

type SessionRow = {
  id: string;
  user_id: string;
  expires_at: string;
  revoked_at: string | null;
};

export type AuthResult =
  | { ok: true; user: AuthUser; token: string; expiresAt: string }
  | { ok: false; reason: string; status: number };

export function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function toPublicUser(row: AppUserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

function validateEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password: string) {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must include at least one letter and one number.";
  }
  return null;
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, PASSWORD_KEY_LENGTH, SCRYPT_OPTIONS).toString("base64url");
  return `scrypt$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${salt}$${hash}`;
}

function verifyPassword(password: string, storedHash: string) {
  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nRaw, rRaw, pRaw, salt, expectedRaw] = parts;
  const N = Number.parseInt(nRaw, 10);
  const r = Number.parseInt(rRaw, 10);
  const p = Number.parseInt(pRaw, 10);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const expected = Buffer.from(expectedRaw, "base64url");
  const actual = scryptSync(password, salt, expected.length, { N, r, p });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function parseCookieHeader(header: string | null, name: string) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rawValue.join("="));
  }
  return null;
}

export function sessionCookieOptions(expiresAt: string) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  };
}

export function clearedSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  };
}

export function getSessionTokenFromRequest(request: Request) {
  return parseCookieHeader(request.headers.get("cookie"), AUTH_COOKIE_NAME);
}

async function findUserByEmail(email: string) {
  const rows = await supabaseRest<AppUserRow[]>("app_users", {
    query: {
      select: "id,email,display_name,password_hash,role,created_at,last_login_at",
      email: `eq.${email}`,
      limit: 1,
    },
  });
  return rows[0] ?? null;
}

async function findUserById(id: string) {
  const rows = await supabaseRest<AppUserRow[]>("app_users", {
    query: {
      select: "id,email,display_name,password_hash,role,created_at,last_login_at",
      id: `eq.${id}`,
      limit: 1,
    },
  });
  return rows[0] ?? null;
}

async function createSession(userId: string, request: Request) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  await supabaseRest("auth_sessions", {
    method: "POST",
    prefer: "return=minimal",
    body: [
      {
        user_id: userId,
        token_hash: sha256(token),
        user_agent: request.headers.get("user-agent"),
        ip_address: forwardedFor,
        expires_at: expiresAt,
      },
    ],
  });

  return { token, expiresAt };
}

export async function registerWithPassword(input: {
  email: unknown;
  displayName: unknown;
  password: unknown;
  request: Request;
}): Promise<AuthResult> {
  const email = normalizeEmail(input.email);
  const displayName = String(input.displayName ?? "").trim();
  const password = String(input.password ?? "");

  if (!validateEmail(email)) {
    return { ok: false, reason: "Enter a valid email address.", status: 400 };
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    return { ok: false, reason: passwordError, status: 400 };
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    return { ok: false, reason: "An account with this email already exists.", status: 409 };
  }

  const [created] = await supabaseRest<AppUserRow[]>("app_users", {
    method: "POST",
    prefer: "return=representation",
    body: [
      {
        email,
        display_name: displayName || email.split("@")[0],
        password_hash: hashPassword(password),
      },
    ],
  });
  const session = await createSession(created.id, input.request);
  return { ok: true, user: toPublicUser(created), ...session };
}

export async function loginWithPassword(input: {
  email: unknown;
  password: unknown;
  request: Request;
}): Promise<AuthResult> {
  const email = normalizeEmail(input.email);
  const password = String(input.password ?? "");
  if (!validateEmail(email) || !password) {
    return { ok: false, reason: "Invalid email or password.", status: 401 };
  }

  const row = await findUserByEmail(email);
  if (!row || !verifyPassword(password, row.password_hash)) {
    return { ok: false, reason: "Invalid email or password.", status: 401 };
  }

  const now = new Date().toISOString();
  await supabaseRest("app_users", {
    method: "PATCH",
    query: { id: `eq.${row.id}` },
    prefer: "return=minimal",
    body: { last_login_at: now, updated_at: now },
  });
  const session = await createSession(row.id, input.request);
  return {
    ok: true,
    user: toPublicUser({ ...row, last_login_at: now }),
    ...session,
  };
}

export async function getCurrentUser(request: Request): Promise<AuthUser | null> {
  const token = getSessionTokenFromRequest(request);
  if (!token) return null;

  const now = new Date().toISOString();
  const sessions = await supabaseRest<SessionRow[]>("auth_sessions", {
    query: {
      select: "id,user_id,expires_at,revoked_at",
      token_hash: `eq.${sha256(token)}`,
      revoked_at: "is.null",
      expires_at: `gt.${now}`,
      limit: 1,
    },
  });
  const session = sessions[0];
  if (!session) return null;

  const user = await findUserById(session.user_id);
  if (!user) return null;

  await supabaseRest("auth_sessions", {
    method: "PATCH",
    query: { id: `eq.${session.id}` },
    prefer: "return=minimal",
    body: { last_seen_at: now },
  });

  return toPublicUser(user);
}

export async function revokeSession(request: Request) {
  const token = getSessionTokenFromRequest(request);
  if (!token) return;
  await supabaseRest("auth_sessions", {
    method: "PATCH",
    query: {
      token_hash: `eq.${sha256(token)}`,
      revoked_at: "is.null",
    },
    prefer: "return=minimal",
    body: { revoked_at: new Date().toISOString() },
  });
}
