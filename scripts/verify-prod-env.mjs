const required = [
  {
    name: "SUPABASE_URL",
    valid: (value) => /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(value),
    hint: "Use the Project URL from Supabase project settings.",
  },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    valid: (value) => value.startsWith("sb_secret_") || value.startsWith("sbp_") || value.startsWith("eyJ"),
    hint: "Use a server-only Supabase service role/secret key. Never expose it as NEXT_PUBLIC_*.",
  },
];

const optional = [
  {
    name: "OPENAI_API_KEY",
    valid: (value) => value === "" || value.startsWith("sk-"),
    hint: "Leave empty while AI generation is disabled, or set a valid OpenAI API key.",
  },
];

function hasPlaceholder(value) {
  return /YOUR_|REPLACE_ME|example|placeholder/i.test(value);
}

function check(entry, requiredValue) {
  const value = process.env[entry.name] ?? "";
  if (!value.trim()) {
    return requiredValue ? `${entry.name} is missing. ${entry.hint}` : null;
  }
  if (hasPlaceholder(value) || !entry.valid(value)) {
    return `${entry.name} is not production-ready. ${entry.hint}`;
  }
  return null;
}

const failures = [
  ...required.map((entry) => check(entry, true)),
  ...optional.map((entry) => check(entry, false)),
].filter(Boolean);

if (failures.length > 0) {
  console.error("Production environment check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Production environment check passed.");
