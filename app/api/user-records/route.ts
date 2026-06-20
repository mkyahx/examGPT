import { getCurrentUser } from "@/lib/server/auth";
import { supabaseRest } from "@/lib/server/supabaseRest";

export const runtime = "nodejs";

type ResourceType = "mock_exam" | "contribution";
type ResourceAction = "accepted" | "submitted";

type UserResourceRecordRow = {
  id: string;
  resource_type: ResourceType;
  action: ResourceAction;
  resource_id: string;
  course_code: string;
  title: string;
  metadata: Record<string, unknown> | null;
  recorded_at: string;
  updated_at: string;
};

function isResourceType(value: unknown): value is ResourceType {
  return value === "mock_exam" || value === "contribution";
}

function isResourceAction(value: unknown): value is ResourceAction {
  return value === "accepted" || value === "submitted";
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const metadata = value as Record<string, unknown>;
  return JSON.stringify(metadata).length <= 50_000 ? metadata : {};
}

function toPublicRecord(row: UserResourceRecordRow) {
  return {
    id: row.id,
    resourceType: row.resource_type,
    action: row.action,
    resourceId: row.resource_id,
    courseCode: row.course_code,
    title: row.title,
    metadata: row.metadata ?? {},
    recordedAt: row.recorded_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) {
    return Response.json({ ok: false, reason: "Sign in to view your records." }, { status: 401 });
  }

  const rows = await supabaseRest<UserResourceRecordRow[]>("user_resource_records", {
    query: {
      select:
        "id,resource_type,action,resource_id,course_code,title,metadata,recorded_at,updated_at",
      user_id: `eq.${user.id}`,
      order: "recorded_at.desc",
      limit: 200,
    },
  });

  return Response.json({ ok: true, records: rows.map(toPublicRecord) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) {
    return Response.json({ ok: false, reason: "Sign in to save this record." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !isResourceType(body.resourceType) || !isResourceAction(body.action)) {
    return Response.json({ ok: false, reason: "Invalid resource record." }, { status: 400 });
  }

  const resourceId = cleanText(body.resourceId, 160);
  if (!resourceId) {
    return Response.json({ ok: false, reason: "resourceId is required." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const rows = await supabaseRest<UserResourceRecordRow[]>("user_resource_records", {
    method: "POST",
    query: { on_conflict: "user_id,resource_type,action,resource_id" },
    prefer: "resolution=merge-duplicates,return=representation",
    body: {
      user_id: user.id,
      resource_type: body.resourceType,
      action: body.action,
      resource_id: resourceId,
      course_code: cleanText(body.courseCode, 32).toUpperCase(),
      title: cleanText(body.title, 240),
      metadata: cleanMetadata(body.metadata),
      updated_at: now,
    },
  });

  return Response.json({ ok: true, record: toPublicRecord(rows[0]) });
}
