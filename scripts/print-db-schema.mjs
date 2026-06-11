#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";

const schemaPath = path.resolve("db/schema.sql");

async function main() {
  const schema = await fs.readFile(schemaPath, "utf8");
  console.log(`-- Apply this SQL in Supabase SQL Editor before the first upload.
-- Source: ${schemaPath}

${schema}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
