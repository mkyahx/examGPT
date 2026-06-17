# ExamGPT Progress

Last updated: 2026-06-17

## Current Product Goal

Build an HKU-focused mock exam tool that can generate practice papers from a trusted past-paper question bank first, then later support AI-generated papers.

## Completed

- Repository cloned from `mkyahx/ExamGPT` and pushed with the Account page change.
- Account page added at `/account`.
- Login, register, BYOK, credits, style profile, and ledger are now grouped under Account.
- `/login` and `/settings` redirect to `/account`.
- Supabase local config is present in `.env.local`.
- Original-question generation has been implemented and verified against Supabase.
- `/generate` can load the database generation profile for `COMP3251`.
- Original mode can generate a 100-mark paper from certified Exambase questions.

## Verified Original Mode

Test course: `COMP3251`

- Supabase profile API returned `ok: true`.
- Database returned 10 available source questions.
- A 100-mark paper can be assembled.
- Browser flow from `/generate` to `/exam/...` works.
- Generated paper summary:
  - mode: `original`
  - course: `COMP3251`
  - questions: 4
  - total marks: 100
  - source: certified Exambase questions

## In Progress

- Generation UI now has two modes:
  - `Original`: enabled
  - `AI`: visible but disabled as Coming soon
- Code paths for AI paper generation exist, but they are not the current priority.

## Deferred

- AI-generated mock papers.
- OpenAI key setup and AI mode verification.
- Full RAG from uploaded notes or PDFs.
- Embeddings and vector search.
- Stripe / PayMe payment integration.
- Secure BYOK vault storage.
- Manual curation override layer for question review.

## Known Local State

- Unrelated homepage/font edits are stashed as:
  - `stash@{0}: wip-homepage-fonts-before-generation-flow`
- `.env.local` is ignored by Git and should stay local.

## Next Recommended Steps

1. Commit and push the original-question generation flow.
2. Do a second browser check for `/generate` after the AI button disable change.
3. Decide whether to restore or discard the stashed homepage/font experiment.
4. Later, when ready, fill `OPENAI_API_KEY` and verify AI mode.
