create extension if not exists pgcrypto;
create schema if not exists extensions;
create extension if not exists vector with schema extensions;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-uploads', 'review-uploads', false, 20971520, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null default '',
  analysis jsonb not null default '{}'::jsonb,
  analysis_generated_at timestamptz,
  analysis_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists extraction_runs (
  id uuid primary key default gen_random_uuid(),
  run_label text,
  source_dir text not null default 'extracted',
  extract_threshold numeric,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  totals jsonb not null default '{}'::jsonb
);

create table if not exists course_topic_sources (
  course_id uuid primary key references courses(id) on delete cascade,
  status text not null check (status in ('ready', 'missing', 'failed')),
  source text not null default 'online-syllabus-lookup',
  source_url text,
  searched_urls jsonb not null default '[]'::jsonb,
  extracted_at timestamptz,
  error text,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists syllabus_topics (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  topic_id text not null,
  label text not null,
  description text not null default '',
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, topic_id)
);

create table if not exists exam_papers (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  pdf_path text not null unique,
  exam_year_month text not null,
  exam_year int,
  exam_month int,
  academic_year text,
  semester text,
  exam_type text,
  paper_date date,
  source_kind text not null default 'unknown',
  question_count int not null default 0,
  total_marks int not null default 0,
  extraction_status text not null,
  stats jsonb not null default '{}'::jsonb,
  raw_source jsonb not null default '{}'::jsonb,
  extraction_run_id uuid references extraction_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists staging_questions (
  id text primary key,
  paper_id uuid not null references exam_papers(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  question_no text not null,
  prompt text not null,
  prompt_hash text not null,
  marks int not null default 10,
  status text not null default 'good' check (status in ('pending', 'good', 'rejected')),
  type text not null,
  question_type_tag text,
  tagging_status text,
  tagged_at timestamptz,
  tag_source text,
  tagging_error text,
  raw jsonb not null default '{}'::jsonb,
  extraction_run_id uuid references extraction_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists staging_question_topic_tags (
  question_id text not null references staging_questions(id) on delete cascade,
  topic_id uuid not null references syllabus_topics(id) on delete cascade,
  topic_key text not null,
  label text not null,
  confidence numeric not null,
  rank int not null,
  raw jsonb not null default '{}'::jsonb,
  primary key (question_id, topic_id)
);

create table if not exists curated_question_overrides (
  staging_question_id text primary key references staging_questions(id) on delete cascade,
  status text not null default 'approved' check (status in ('approved', 'hidden', 'needs_fix')),
  prompt_override text,
  type_override text,
  question_type_tag_override text,
  notes text,
  reviewed_by text,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists question_embeddings (
  question_id text not null references staging_questions(id) on delete cascade,
  model text not null,
  embedding extensions.vector(1536),
  content_hash text not null,
  created_at timestamptz not null default now(),
  primary key (question_id, model)
);

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null default '',
  password_hash text not null,
  role text not null default 'student' check (role in ('student', 'admin')),
  email_verified_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  token_hash text not null unique,
  user_agent text,
  ip_address text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at)
);

create table if not exists user_resource_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  resource_type text not null check (resource_type in ('mock_exam', 'contribution')),
  action text not null check (action in ('accepted', 'submitted')),
  resource_id text not null,
  course_code text not null default '',
  title text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, resource_type, action, resource_id)
);

create table if not exists user_mock_exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  exam_id text not null,
  course_code text not null default '',
  generation_mode text,
  exam_data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, exam_id)
);

create table if not exists user_feedback_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  feedback_id text not null,
  exam_id text not null,
  similarity int not null check (similarity between 1 and 10),
  difficulty int not null check (difficulty between 1 and 10),
  notes text not null default '',
  feedback_data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, exam_id)
);

alter table courses add column if not exists analysis jsonb not null default '{}'::jsonb;
alter table courses add column if not exists analysis_generated_at timestamptz;
alter table courses add column if not exists analysis_source text;

alter table exam_papers add column if not exists academic_year text;
alter table exam_papers add column if not exists semester text;
alter table exam_papers add column if not exists exam_type text;
alter table exam_papers add column if not exists paper_date date;
alter table exam_papers add column if not exists source_kind text not null default 'unknown';
alter table exam_papers add column if not exists question_count int not null default 0;
alter table exam_papers add column if not exists total_marks int not null default 0;

alter table staging_questions add column if not exists status text;
update staging_questions
set status = 'good'
where status is null;
alter table staging_questions alter column status set default 'good';
alter table staging_questions alter column status set not null;
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'staging_questions'::regclass
      and conname = 'staging_questions_status_check'
  ) then
    alter table staging_questions
      add constraint staging_questions_status_check
      check (status in ('pending', 'good', 'rejected'));
  end if;
end;
$$;

alter table staging_questions add column if not exists marks int;
update staging_questions
set marks = coalesce(
  marks,
  nullif(substring(prompt from '\((\d{1,3})\s*(?:points?|marks?)\)'), '')::int,
  case
    when type in ('multiple_choice', 'fill_blank') then 4
    when type in ('coding', 'long_answer') then 20
    when type = 'short_answer' then 10
    else 10
  end
)
where marks is null;
alter table staging_questions alter column marks set default 10;
alter table staging_questions alter column marks set not null;

update exam_papers
set
  source_kind = case
    when pdf_path like 'downloads/%' then 'exambase'
    when pdf_path like 'review-uploads/%' then 'user_upload'
    else coalesce(nullif(source_kind, ''), 'unknown')
  end,
  semester = coalesce(
    semester,
    raw_source->>'semester',
    case
      when exam_month = 12 then 'Semester 1'
      when exam_month = 5 then 'Semester 2'
      when exam_month = 8 then 'Summer'
      else 'Unknown'
    end
  ),
  academic_year = coalesce(
    academic_year,
    raw_source->>'academicYear',
    case
      when exam_year is null or exam_month is null then null
      when exam_month >= 9 then exam_year::text || '-' || (exam_year + 1)::text
      else (exam_year - 1)::text || '-' || exam_year::text
    end
  ),
  exam_type = coalesce(exam_type, raw_source->>'examType', 'Final'),
  paper_date = coalesce(
    paper_date,
    case
      when exam_year is not null and exam_month between 1 and 12
        then make_date(exam_year, exam_month, 1)
      else null
    end
  );

update exam_papers p
set
  question_count = counts.question_count,
  total_marks = counts.total_marks
from (
  select paper_id, count(*)::int as question_count, coalesce(sum(marks), 0)::int as total_marks
  from staging_questions
  group by paper_id
) counts
where counts.paper_id = p.id;

alter table courses enable row level security;
alter table extraction_runs enable row level security;
alter table course_topic_sources enable row level security;
alter table syllabus_topics enable row level security;
alter table exam_papers enable row level security;
alter table staging_questions enable row level security;
alter table staging_question_topic_tags enable row level security;
alter table curated_question_overrides enable row level security;
alter table question_embeddings enable row level security;
alter table app_users enable row level security;
alter table auth_sessions enable row level security;
alter table user_resource_records enable row level security;
alter table user_mock_exams enable row level security;
alter table user_feedback_entries enable row level security;

revoke all on table user_resource_records from anon, authenticated;
grant select, insert, update, delete on table user_resource_records to service_role;
revoke all on table user_mock_exams from anon, authenticated;
revoke all on table user_feedback_entries from anon, authenticated;
grant select, insert, update, delete on table user_mock_exams to service_role;
grant select, insert, update, delete on table user_feedback_entries to service_role;

create index if not exists idx_courses_code on courses (code);
create index if not exists idx_exam_papers_course_year on exam_papers (course_id, exam_year, exam_month);
create index if not exists idx_exam_papers_source_kind on exam_papers (course_id, source_kind);
create index if not exists idx_staging_questions_course_type on staging_questions (course_id, question_type_tag);
create index if not exists idx_staging_questions_status on staging_questions (status);
create index if not exists idx_staging_questions_marks on staging_questions (course_id, marks);
create index if not exists idx_staging_questions_prompt_fts on staging_questions using gin (to_tsvector('english', coalesce(prompt, '')));
create index if not exists idx_staging_question_topic_tags_topic on staging_question_topic_tags (topic_id);
create index if not exists idx_syllabus_topics_course_topic on syllabus_topics (course_id, topic_id);
create index if not exists idx_app_users_email on app_users (email);
create index if not exists idx_auth_sessions_user on auth_sessions (user_id);
create index if not exists idx_auth_sessions_token_hash on auth_sessions (token_hash);
create index if not exists idx_auth_sessions_active on auth_sessions (expires_at)
  where revoked_at is null;
create index if not exists idx_user_resource_records_user_time
  on user_resource_records (user_id, recorded_at desc);
create index if not exists idx_user_resource_records_resource
  on user_resource_records (resource_type, action, resource_id);
create index if not exists idx_user_mock_exams_user_updated
  on user_mock_exams (user_id, updated_at desc);
create index if not exists idx_user_feedback_entries_user_updated
  on user_feedback_entries (user_id, updated_at desc);
create index if not exists idx_user_feedback_entries_exam
  on user_feedback_entries (user_id, exam_id);

drop function if exists get_course_generation_profile(text);
drop function if exists refresh_course_analysis(text);
drop function if exists search_questions(text, int, int, text, text, text, int, int);
drop function if exists search_questions(text, int, int, text, text, text, int, int, text);
drop view if exists course_library_v;
drop view if exists paper_library_v;
drop view if exists question_review_v;
drop view if exists question_search_v;

create view question_search_v
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
  p.academic_year,
  p.semester,
  p.exam_type,
  p.paper_date,
  p.source_kind,
  q.question_no,
  coalesce(o.prompt_override, q.prompt) as prompt,
  q.prompt_hash,
  q.marks,
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

create view question_review_v
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
  p.academic_year,
  p.semester,
  p.exam_type,
  p.paper_date,
  p.source_kind,
  q.question_no,
  q.prompt,
  q.prompt_hash,
  q.marks,
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

create view paper_library_v
with (security_invoker = true)
as
select
  p.id,
  c.code as course_code,
  c.name as course_name,
  p.pdf_path,
  p.exam_year_month,
  p.exam_year,
  p.exam_month,
  p.academic_year,
  p.semester,
  p.exam_type,
  p.paper_date,
  p.source_kind,
  p.extraction_status,
  coalesce(nullif(p.question_count, 0), paper_counts.question_count, 0) as question_count,
  coalesce(nullif(p.total_marks, 0), paper_counts.total_marks, 0) as total_marks,
  p.stats,
  p.raw_source,
  coalesce(question_rows.questions, '[]'::jsonb) as questions
from exam_papers p
join courses c on c.id = p.course_id
left join lateral (
  select
    count(*)::int as question_count,
    coalesce(sum(q.marks), 0)::int as total_marks
  from staging_questions q
  where q.paper_id = p.id and q.status = 'good'
) paper_counts on true
left join lateral (
  select jsonb_agg(
    jsonb_build_object(
      'id', q.id,
      'questionNo', q.question_no,
      'marks', q.marks,
      'type', q.type,
      'questionTypeTag', q.question_type_tag,
      'promptPreview', left(q.prompt, 240),
      'topicTags', coalesce(topic_tags.topic_tags, '[]'::jsonb)
    )
    order by q.question_no
  ) as questions
  from staging_questions q
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'topicId', st.topic_id,
        'label', qt.label,
        'confidence', qt.confidence,
        'rank', qt.rank
      )
      order by qt.rank
    ) as topic_tags
    from staging_question_topic_tags qt
    join syllabus_topics st on st.id = qt.topic_id
    where qt.question_id = q.id
  ) topic_tags on true
  where q.paper_id = p.id and q.status = 'good'
) question_rows on true;

create view course_library_v
with (security_invoker = true)
as
select
  c.id,
  c.code as course_code,
  c.name as course_name,
  count(p.id)::int as paper_count,
  coalesce(sum(p.question_count), 0)::int as question_count,
  coalesce(sum(p.total_marks), 0)::int as total_marks,
  c.analysis,
  c.analysis_generated_at,
  c.analysis_source,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'pdfPath', p.pdf_path,
        'examYearMonth', p.exam_year_month,
        'academicYear', p.academic_year,
        'semester', p.semester,
        'examType', p.exam_type,
        'paperDate', p.paper_date,
        'sourceKind', p.source_kind,
        'questionCount', p.question_count,
        'totalMarks', p.total_marks
      )
      order by p.exam_year desc nulls last, p.exam_month desc nulls last, p.pdf_path
    ) filter (where p.id is not null),
    '[]'::jsonb
  ) as papers
from courses c
left join paper_library_v p on p.course_code = c.code
group by c.id, c.code, c.name, c.analysis, c.analysis_generated_at, c.analysis_source;

create or replace function refresh_course_analysis(course_query text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_course_id uuid;
  v_course_code text;
  v_paper_count int := 0;
  v_question_count int := 0;
  v_avg_questions numeric := 0;
  v_min_questions int := 0;
  v_max_questions int := 0;
  v_avg_marks numeric := 0;
  v_min_marks int := 0;
  v_max_marks int := 0;
  v_papers jsonb := '[]'::jsonb;
  v_type_items jsonb := '[]'::jsonb;
  v_topic_items jsonb := '[]'::jsonb;
  v_position_items jsonb := '[]'::jsonb;
  v_analysis jsonb;
begin
  select id, code
  into v_course_id, v_course_code
  from courses
  where code = upper(trim(course_query))
  limit 1;

  if v_course_id is null then
    raise exception 'Course not found: %', course_query;
  end if;

  with scoped_papers as (
    select *
    from exam_papers
    where course_id = v_course_id and source_kind = 'exambase'
  ),
  paper_stats as (
    select
      p.id,
      p.pdf_path,
      p.exam_year_month,
      p.exam_year,
      p.exam_month,
      p.academic_year,
      p.semester,
      p.exam_type,
      p.paper_date,
      count(q.id)::int as question_count,
      coalesce(sum(q.marks), 0)::int as total_marks
    from scoped_papers p
    left join staging_questions q on q.paper_id = p.id and q.status = 'good'
    group by p.id, p.pdf_path, p.exam_year_month, p.exam_year, p.exam_month, p.academic_year, p.semester, p.exam_type, p.paper_date
    having count(q.id) > 0
  )
  select
    count(*)::int,
    coalesce(sum(question_count), 0)::int,
    coalesce(round(avg(question_count)::numeric, 2), 0),
    coalesce(min(question_count), 0),
    coalesce(max(question_count), 0),
    coalesce(round(avg(total_marks)::numeric, 2), 0),
    coalesce(min(total_marks), 0),
    coalesce(max(total_marks), 0),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'pdfPath', pdf_path,
          'examYearMonth', exam_year_month,
          'academicYear', academic_year,
          'semester', semester,
          'examType', exam_type,
          'paperDate', paper_date,
          'questionCount', question_count,
          'totalMarks', total_marks
        )
        order by exam_year desc nulls last, exam_month desc nulls last, pdf_path
      ),
      '[]'::jsonb
    )
  into
    v_paper_count,
    v_question_count,
    v_avg_questions,
    v_min_questions,
    v_max_questions,
    v_avg_marks,
    v_min_marks,
    v_max_marks,
    v_papers
  from paper_stats;

  with good_questions as (
    select coalesce(q.question_type_tag, q.type, 'unknown') as type_id
    from staging_questions q
    join exam_papers p on p.id = q.paper_id
    where q.course_id = v_course_id
      and q.status = 'good'
      and p.source_kind = 'exambase'
  ),
  counts as (
    select type_id, count(*)::int as item_count
    from good_questions
    group by type_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', type_id,
        'label', type_id,
        'count', item_count,
        'shareOfQuestions', case when v_question_count = 0 then 0 else round(item_count::numeric / v_question_count, 4) end
      )
      order by item_count desc, type_id
    ),
    '[]'::jsonb
  )
  into v_type_items
  from counts;

  with good_questions as (
    select
      q.id,
      q.paper_id,
      coalesce(st.topic_id, 'unknown') as topic_id,
      coalesce(qt.label, 'unknown') as topic_label
    from staging_questions q
    join exam_papers p on p.id = q.paper_id
    left join staging_question_topic_tags qt on qt.question_id = q.id and qt.rank = 1
    left join syllabus_topics st on st.id = qt.topic_id
    where q.course_id = v_course_id
      and q.status = 'good'
      and p.source_kind = 'exambase'
  ),
  counts as (
    select
      topic_id,
      max(topic_label) as topic_label,
      count(*)::int as item_count,
      count(distinct paper_id)::int as paper_count
    from good_questions
    group by topic_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', topic_id,
        'label', topic_label,
        'count', item_count,
        'paperCount', paper_count,
        'shareOfQuestions', case when v_question_count = 0 then 0 else round(item_count::numeric / v_question_count, 4) end
      )
      order by item_count desc, topic_id
    ),
    '[]'::jsonb
  )
  into v_topic_items
  from counts;

  with good_questions as (
    select
      q.question_no,
      coalesce(q.question_type_tag, q.type, 'unknown') as type_id,
      coalesce(st.topic_id, 'unknown') as topic_id,
      coalesce(qt.label, 'unknown') as topic_label
    from staging_questions q
    join exam_papers p on p.id = q.paper_id
    left join staging_question_topic_tags qt on qt.question_id = q.id and qt.rank = 1
    left join syllabus_topics st on st.id = qt.topic_id
    where q.course_id = v_course_id
      and q.status = 'good'
      and p.source_kind = 'exambase'
  ),
  positions as (
    select question_no, count(*)::int as question_count
    from good_questions
    group by question_no
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'questionNo', p.question_no,
        'questionCount', p.question_count,
        'commonTypes', coalesce(type_counts.items, '[]'::jsonb),
        'commonPrimaryTopics', coalesce(topic_counts.items, '[]'::jsonb)
      )
      order by lpad(p.question_no, 12, '0')
    ),
    '[]'::jsonb
  )
  into v_position_items
  from positions p
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', type_id,
        'label', type_id,
        'count', item_count,
        'shareOfQuestions', round(item_count::numeric / greatest(p.question_count, 1), 4)
      )
      order by item_count desc, type_id
    ) as items
    from (
      select type_id, count(*)::int as item_count
      from good_questions
      where question_no = p.question_no
      group by type_id
    ) t
  ) type_counts on true
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', topic_id,
        'label', topic_label,
        'count', item_count,
        'shareOfQuestions', round(item_count::numeric / greatest(p.question_count, 1), 4)
      )
      order by item_count desc, topic_id
    ) as items
    from (
      select topic_id, max(topic_label) as topic_label, count(*)::int as item_count
      from good_questions
      where question_no = p.question_no
      group by topic_id
    ) t
  ) topic_counts on true;

  v_analysis := jsonb_build_object(
    'paperCount', v_paper_count,
    'questionCount', v_question_count,
    'questionCountPerPaper', jsonb_build_object(
      'average', v_avg_questions,
      'min', v_min_questions,
      'max', v_max_questions
    ),
    'totalMarksPerPaper', jsonb_build_object(
      'average', v_avg_marks,
      'min', v_min_marks,
      'max', v_max_marks
    ),
    'questionTypeDistribution', jsonb_build_object('items', v_type_items),
    'primaryTopicDistribution', jsonb_build_object('items', v_topic_items),
    'questionPositionPatterns', v_position_items,
    'papers', v_papers,
    'generatedAt', now(),
    'source', 'supabase:refresh_course_analysis'
  );

  update courses
  set
    analysis = v_analysis,
    analysis_generated_at = now(),
    analysis_source = 'supabase:refresh_course_analysis',
    updated_at = now()
  where id = v_course_id;

  return v_analysis;
end;
$$;

create or replace function get_course_generation_profile(course_query text)
returns table (
  course_code text,
  course_name text,
  analysis jsonb,
  papers jsonb,
  questions jsonb
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_course courses%rowtype;
  v_analysis jsonb;
  v_papers jsonb;
  v_questions jsonb;
begin
  select *
  into v_course
  from courses
  where code = upper(trim(course_query))
  limit 1;

  if not found then
    return;
  end if;

  if v_course.analysis is null or v_course.analysis = '{}'::jsonb then
    v_analysis := refresh_course_analysis(v_course.code);
  else
    v_analysis := v_course.analysis;
  end if;

  select coalesce(cl.papers, '[]'::jsonb)
  into v_papers
  from course_library_v cl
  where cl.course_code = v_course.code;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', v.id,
        'course_code', v.course_code,
        'course_name', v.course_name,
        'pdf_path', v.pdf_path,
        'exam_year_month', v.exam_year_month,
        'exam_year', v.exam_year,
        'exam_month', v.exam_month,
        'academic_year', v.academic_year,
        'semester', v.semester,
        'exam_type', v.exam_type,
        'paper_date', v.paper_date,
        'source_kind', v.source_kind,
        'question_no', v.question_no,
        'prompt', v.prompt,
        'prompt_preview', left(v.prompt, 500),
        'marks', v.marks,
        'status', v.status,
        'type', v.type,
        'question_type_tag', v.question_type_tag,
        'curation_status', v.curation_status,
        'topic_tags', v.topic_tags,
        'rank', 0
      )
      order by v.exam_year desc nulls last, v.exam_month desc nulls last, v.question_no
    ),
    '[]'::jsonb
  )
  into v_questions
  from question_search_v v
  where v.course_code = v_course.code and v.source_kind = 'exambase';

  return query
  select
    v_course.code,
    v_course.name,
    v_analysis,
    coalesce(v_papers, '[]'::jsonb),
    coalesce(v_questions, '[]'::jsonb);
end;
$$;

create or replace function search_questions(
  course_query text default null,
  year_query int default null,
  month_query int default null,
  type_query text default null,
  topic_query text default null,
  text_query text default null,
  page_size int default 20,
  page_offset int default 0,
  source_query text default null
)
returns table (
  id text,
  course_code text,
  course_name text,
  pdf_path text,
  exam_year_month text,
  exam_year int,
  exam_month int,
  academic_year text,
  semester text,
  exam_type text,
  paper_date date,
  source_kind text,
  question_no text,
  prompt text,
  prompt_preview text,
  marks int,
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
    v.academic_year,
    v.semester,
    v.exam_type,
    v.paper_date,
    v.source_kind,
    v.question_no,
    v.prompt,
    left(v.prompt, 500) as prompt_preview,
    v.marks,
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
    and (nullif(trim(source_query), '') is null or v.source_kind = trim(source_query))
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

revoke execute on function refresh_course_analysis(text) from public, anon, authenticated;
revoke execute on function get_course_generation_profile(text) from public, anon, authenticated;
revoke execute on function search_questions(text, int, int, text, text, text, int, int, text) from public, anon, authenticated;

grant execute on function refresh_course_analysis(text) to service_role;
grant execute on function get_course_generation_profile(text) to service_role;
grant execute on function search_questions(text, int, int, text, text, text, int, int, text) to service_role;

grant usage on schema public to service_role;
grant select, insert, update, delete on table app_users to service_role;
grant select, insert, update, delete on table auth_sessions to service_role;

drop policy if exists app_users_no_direct_client_access on app_users;
create policy app_users_no_direct_client_access
  on app_users
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists auth_sessions_no_direct_client_access on auth_sessions;
create policy auth_sessions_no_direct_client_access
  on auth_sessions
  for all
  to anon, authenticated
  using (false)
  with check (false);
