-- Add topic column to question_items.
-- topic is the fine-grained subject topic extracted from the source explanation image footer
-- (e.g. "Right to counsel", "Double jeopardy", "Search and seizure").
-- It is more specific than chapter and maps to the Topic column in the UWorld footer.

alter table public.question_items
  add column if not exists topic text;

-- Expose topic in the questions view.
drop view if exists public.questions;
create view public.questions as
with choice_rows as (
  select
    question_id,
    array_agg(choice order by sort_order) as options,
    max(choice) filter (where is_correct) as correct_answer
  from public.question_choices
  where language = 'en'
  group by question_id
),
mixed_choice_rows as (
  select
    question_id,
    array_agg(choice order by sort_order) as bilingual_options,
    max(choice) filter (where is_correct) as bilingual_correct_answer
  from public.question_choices
  where language = 'mixed'
  group by question_id
),
text_rows as (
  select
    question_id,
    max(question_stem) filter (where language = 'en') as source_question_stem,
    max(question_stem) filter (where language = 'mixed') as fetched_question_stem
  from public.question_texts
  group by question_id
),
en_explanation_rows as (
  select
    question_id,
    array_agg(public_url order by sort_order) filter (where public_url is not null) as explain_imgs,
    min(explanation_image_file) as source_explanation_image_file,
    min(public_url) as source_explanation_image_url,
    max(explanation_html) filter (where source = 'enriched') as en_explanation_html
  from public.question_explanations
  where language = 'en'
  group by question_id
),
zh_explanation_rows as (
  select
    question_id,
    coalesce(
      max(explanation_html) filter (where source = 'enriched'),
      max(explanation_html) filter (where source = 'castudy')
    ) as explanation_html,
    array_agg(public_url order by sort_order) filter (where public_url is not null) as zh_explain_imgs
  from public.question_explanations
  where language = 'zh'
  group by question_id
),
zh_text_rows as (
  select
    question_id,
    max(question_stem) filter (where language = 'zh') as zh_question_stem
  from public.question_texts
  group by question_id
),
zh_choice_rows as (
  select
    question_id,
    array_agg(choice order by sort_order) as zh_options
  from public.question_choices
  where language = 'zh'
  group by question_id
)
select
  q.id,
  q."index",
  s.subject,
  ch.id as chapter_id,
  ch.chapter as chapter_name,
  coalesce(tr.source_question_stem, q.source_question, q.question) as question_text,
  tr.fetched_question_stem,
  ztr.zh_question_stem,
  coalesce(cr.options, '{}') as options,
  coalesce(mcr.bilingual_options, '{}') as bilingual_options,
  coalesce(zcr.zh_options, '{}') as zh_options,
  cr.correct_answer,
  mcr.bilingual_correct_answer,
  q.correct_answer as correct_answer_letter,
  coalesce(q.api_match_ok, false) as api_match_ok,
  q.api_match_score,
  q.api_qid,
  q.api_answer_key,
  coalesce(er.explain_imgs, '{}') as explain_imgs,
  er.source_explanation_image_file,
  er.source_explanation_image_url,
  er.en_explanation_html,
  zh.explanation_html,
  coalesce(zh.zh_explain_imgs, '{}') as zh_explain_imgs,
  -- AI metadata columns
  q.topic as topic,
  q.micro_concept,
  q.trap_type,
  q.trap_type_is_new,
  q.skill_tested,
  q.keyword_meta,
  q.highlight_meta,
  q.raw
from public.question_items q
join public.chapters ch on ch.id = q.chapter_id
join public.subjects s on s.id = ch.subject_id
left join choice_rows cr on cr.question_id = q.id
left join mixed_choice_rows mcr on mcr.question_id = q.id
left join text_rows tr on tr.question_id = q.id
left join zh_text_rows ztr on ztr.question_id = q.id
left join zh_choice_rows zcr on zcr.question_id = q.id
left join en_explanation_rows er on er.question_id = q.id
left join zh_explanation_rows zh on zh.question_id = q.id;
