# ExamGPT

HKU-focused mock exam generation from a curated past-paper question bank.

## Local development

```bash
npm install
copy .env.example .env.local
npm run dev
```

Open `http://127.0.0.1:3000`.

## Required production configuration

- Node.js 20.19 or newer
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- Supabase schema from `db/schema.sql`
- Private Supabase Storage bucket `review-uploads` (created by the schema)

`OPENAI_API_KEY` is optional while AI generation remains disabled.

## Verification

```bash
npm run lint
npx tsc --noEmit
npm run build
npm audit --omit=dev
```

Mock exams and feedback are synchronized to the signed-in user's Supabase account. Uploaded PDFs
are stored in private Supabase Storage; extraction uses temporary server files that are removed
after processing.
