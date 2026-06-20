import { getSupabaseConfig } from "@/lib/server/supabaseRest";

function objectUrl(bucket: string, objectPath: string) {
  const config = getSupabaseConfig();
  const encodedPath = objectPath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return {
    config,
    url: `${config.projectUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`,
  };
}

export async function uploadStorageObject(input: {
  bucket: string;
  objectPath: string;
  bytes: Uint8Array;
  contentType: string;
}) {
  const { config, url } = objectUrl(input.bucket, input.objectPath);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      apikey: config.key,
      "content-type": input.contentType,
      "x-upsert": "true",
    },
    body: Buffer.from(input.bytes),
  });
  if (!response.ok) {
    throw new Error(`Storage upload failed (${response.status}): ${await response.text()}`);
  }
  return `${input.bucket}/${input.objectPath}`;
}

export async function deleteStorageObject(bucket: string, objectPath: string) {
  const { config } = objectUrl(bucket, objectPath);
  const response = await fetch(`${config.projectUrl}/storage/v1/object/${encodeURIComponent(bucket)}`, {
    method: "DELETE",
    headers: {
      apikey: config.key,
      "content-type": "application/json",
    },
    body: JSON.stringify({ prefixes: [objectPath] }),
  });
  if (!response.ok) {
    throw new Error(`Storage delete failed (${response.status}): ${await response.text()}`);
  }
}
