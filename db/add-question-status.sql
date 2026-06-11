alter table staging_questions
add column if not exists status text not null default 'good';

update staging_questions
set status = 'good'
where status is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'staging_questions_status_check'
      and conrelid = 'public.staging_questions'::regclass
  ) then
    alter table staging_questions
    add constraint staging_questions_status_check
    check (status in ('pending', 'good', 'rejected'));
  end if;
end $$;

create index if not exists idx_staging_questions_status on staging_questions (status);

drop function if exists search_questions(
  text,
  int,
  int,
  text,
  text,
  text,
  int,
  int
);
drop view if exists question_search_v;
drop view if exists question_review_v;

create or replace view question_search_v
with (security_invoker = true)
as
select
  q.id,
  c.code as course_code,
  c.name as course_name,
  p.pdf_path,
  p.exam_year_month,
  p.exam_year,
  p.exam_month,
  q.question_no,
  coalesce(o.prompt_override, q.prompt) as prompt,
  q.prompt_hash,
  q.status,
  coalesce(o.type_override, q.type) as type,
  coalesce(o.question_type_tag_override, q.question_type_tag) as question_type_tag,
  q.tagging_status,
  q.tag_source,
  coalesce(o.status, 'approved') as curation_status,
  coalesce(topic_tags.topic_tags, '[]'::jsonb) as topic_tags,
  q.raw
from staging_questions q
join courses c on c.id = q.course_id
join exam_papers p on p.id = q.paper_id
left join curated_question_overrides o on o.staging_question_id = q.id
left join lateral (
  select jsonb_agg(
    jsonb_build_object(
      'topicId', t.topic_id,
      'label', qt.label,
      'confidence', qt.confidence,
      'rank', qt.rank
    )
    order by qt.rank
  ) as topic_tags
  from staging_question_topic_tags qt
  join syllabus_topics t on t.id = qt.topic_id
  where qt.question_id = q.id
) topic_tags on true
where q.status = 'good' and coalesce(o.status, 'approved') <> 'hidden';

create or replace view question_review_v
with (security_invoker = true)
as
select
  q.id,
  q.status,
  c.code as course_code,
  c.name as course_name,
  p.pdf_path,
  p.exam_year_month,
  p.exam_year,
  p.exam_month,
  q.question_no,
  q.prompt,
  q.prompt_hash,
  q.type,
  q.question_type_tag,
  q.tagging_status,
  q.tag_source,
  coalesce(topic_tags.topic_tags, '[]'::jsonb) as topic_tags,
  q.raw->>'reviewUploadId' as review_upload_id,
  q.raw,
  p.raw_source as paper_raw_source
from staging_questions q
join courses c on c.id = q.course_id
join exam_papers p on p.id = q.paper_id
left join lateral (
  select jsonb_agg(
    jsonb_build_object(
      'topicId', t.topic_id,
      'label', qt.label,
      'confidence', qt.confidence,
      'rank', qt.rank
    )
    order by qt.rank
  ) as topic_tags
  from staging_question_topic_tags qt
  join syllabus_topics t on t.id = qt.topic_id
  where qt.question_id = q.id
) topic_tags on true
where q.status in ('pending', 'rejected');

create or replace function search_questions(
  course_query text default null,
  year_query int default null,
  month_query int default null,
  type_query text default null,
  topic_query text default null,
  text_query text default null,
  page_size int default 20,
  page_offset int default 0
)
returns table (
  id text,
  course_code text,
  course_name text,
  pdf_path text,
  exam_year_month text,
  exam_year int,
  exam_month int,
  question_no text,
  prompt text,
  prompt_preview text,
  status text,
  type text,
  question_type_tag text,
  curation_status text,
  topic_tags jsonb,
  rank real
)
language sql
stable
as $$
  select
    v.id,
    v.course_code,
    v.course_name,
    v.pdf_path,
    v.exam_year_month,
    v.exam_year,
    v.exam_month,
    v.question_no,
    v.prompt,
    left(v.prompt, 500) as prompt_preview,
    v.status,
    v.type,
    v.question_type_tag,
    v.curation_status,
    v.topic_tags,
    case
      when nullif(trim(text_query), '') is null then 0
      else ts_rank(to_tsvector('english', coalesce(v.prompt, '')), plainto_tsquery('english', text_query))
    end as rank
  from question_search_v v
  where
    (nullif(trim(course_query), '') is null or v.course_code ilike upper(trim(course_query)) || '%')
    and (year_query is null or v.exam_year = year_query)
    and (month_query is null or v.exam_month = month_query)
    and (nullif(trim(type_query), '') is null or v.question_type_tag = trim(type_query) or v.type = trim(type_query))
    and (
      nullif(trim(topic_query), '') is null
      or exists (
        select 1
        from staging_question_topic_tags qt
        join syllabus_topics st on st.id = qt.topic_id
        where qt.question_id = v.id and st.topic_id = trim(topic_query)
      )
    )
    and (
      nullif(trim(text_query), '') is null
      or to_tsvector('english', coalesce(v.prompt, '')) @@ plainto_tsquery('english', text_query)
    )
  order by
    rank desc,
    v.exam_year desc nulls last,
    v.exam_month desc nulls last,
    v.course_code asc,
    v.question_no asc
  limit greatest(1, least(page_size, 100))
  offset greatest(0, page_offset);
$$;
