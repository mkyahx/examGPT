# Database Upload Plan

## Summary

Use Supabase Free Postgres as the first real database for the extracted HKU past-paper question bank. The local `extracted/` JSON files remain the source of truth for the extraction pipeline, and database upload is idempotent so rerunning extraction can safely overwrite staging data.

The first version stores only metadata and question text. PDF files stay local and are referenced by `downloads/...pdf` paths. Embeddings are schema-ready but not generated yet.

## Data Model

- `courses`: canonical course code and display name.
- `exam_papers`: one row per downloaded PDF / extracted paper, including `pdf_path`, `exam_year_month`, extraction status, and raw source metadata.
- `course_topic_sources`: status and provenance for `extracted/course-topics/{COURSE}.topics.json`.
- `syllabus_topics`: normalized topic list per course.
- `extraction_runs`: one upload run with threshold, source dir, and totals.
- `staging_questions`: direct upsert target for extracted questions, keyed by existing stable `question.id`.
- `staging_question_topic_tags`: many-to-many question-topic tags with confidence and rank.
- `curated_question_overrides`: optional future manual review layer over staging questions.
- `question_embeddings`: reserved for later RAG vector search.

## Upload Flow

1. Read all `extracted/course-topics/*.topics.json`.
2. Read all `extracted/{COURSE}/*.questions.json`.
3. Upsert courses, topic source records, syllabus topics, exam papers, and staging questions.
4. For each uploaded question, delete existing topic tags and insert the tags from the current JSON.
5. Store `no_questions_found` papers as `exam_papers` rows without question rows.
6. Record run totals in `extraction_runs`.

## Search And Generation

First version search filters by course prefix, year, month, question type, topic, and full-text query. Generation retrieval uses the same search surface to return source questions for a later generator.

Embeddings are intentionally deferred. When ready, populate `question_embeddings` and switch retrieval to hybrid metadata + full-text + vector search.

## Current Expected Totals

- Courses: 43
- Papers: 176
- OK papers: 174
- `no_questions_found` papers: 2
- Questions: 659
- Topic-tagged questions: 290

## Operational Assumptions

- Use `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` only in server/script environments.
- Do not expose service-role credentials to the browser.
- Use Supabase SQL Editor to apply `db/schema.sql`.
- Use `npm run upload:extracted:dry` before the first real upload.
