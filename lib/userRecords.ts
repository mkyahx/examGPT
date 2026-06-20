import type { UserResourceRecord } from "@/lib/types";

type RecordInput = {
  resourceType: UserResourceRecord["resourceType"];
  action: UserResourceRecord["action"];
  resourceId: string;
  courseCode: string;
  title: string;
  metadata?: Record<string, unknown>;
};

export async function saveUserResourceRecord(input: RecordInput) {
  const response = await fetch("/api/user-records", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(input),
  });
  return response.ok;
}

export async function fetchUserResourceRecords(): Promise<UserResourceRecord[]> {
  const response = await fetch("/api/user-records", {
    method: "GET",
    credentials: "same-origin",
  });
  if (!response.ok) return [];

  const payload = (await response.json()) as {
    ok?: boolean;
    records?: UserResourceRecord[];
  };
  return payload.ok && Array.isArray(payload.records) ? payload.records : [];
}
