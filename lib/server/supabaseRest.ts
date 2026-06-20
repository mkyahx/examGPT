type QueryParams = Record<string, string | number | boolean | null | undefined>;

type SupabaseRestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: QueryParams;
  body?: unknown;
  prefer?: string;
};

export function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  return {
    projectUrl: normalizeSupabaseProjectUrl(supabaseUrl),
    restUrl: `${normalizeSupabaseProjectUrl(supabaseUrl)}/rest/v1`,
    key: serviceRoleKey,
  };
}

function normalizeSupabaseProjectUrl(value: string) {
  return value.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
}

function createSupabaseHeaders(key: string, prefer?: string) {
  return {
    apikey: key,
    "content-type": "application/json",
    ...(key.startsWith("sb_") ? {} : { authorization: `Bearer ${key}` }),
    ...(prefer ? { prefer } : {}),
  };
}

export async function supabaseRest<T>(path: string, options: SupabaseRestOptions = {}): Promise<T> {
  const config = getSupabaseConfig();
  const url = new URL(`${config.restUrl}/${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: createSupabaseHeaders(config.key, options.prefer),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} failed (${response.status}): ${text}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

export async function supabaseRpc<T>(name: string, body: unknown): Promise<T> {
  return supabaseRest<T>(`rpc/${name}`, {
    method: "POST",
    body,
  });
}
