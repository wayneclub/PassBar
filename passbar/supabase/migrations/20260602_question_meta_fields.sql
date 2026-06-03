-- Add micro_concept, trap_type, skill_tested to question_items
-- and allow admins to update question metadata via RLS policy
alter table public.question_items
  add column if not exists micro_concept text,
  add column if not exists trap_type     text,
  add column if not exists skill_tested  text;

-- Recreate questions view to expose the new columns
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
  ch.chapter as topic,
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
  -- new metadata columns
  q.micro_concept,
  q.trap_type,
  q.skill_tested,
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

-- Allow admins to update question metadata fields on question_items
drop policy if exists "Admins can update question metadata" on public.question_items;
create policy "Admins can update question metadata"
on public.question_items for update
using (public.is_admin())
with check (public.is_admin());
