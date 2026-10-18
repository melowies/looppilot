-- Apply manually to the existing database. Never edit/reapply older migrations.
begin;
alter table public.coding_attempts alter column confidence drop not null;
alter table public.coding_attempts alter column hints drop not null;
alter table public.behavioral_stories alter column confidence drop not null;
alter table public.coding_attempts add constraint independent_requires_known_zero_hints
 check (assistance <> 'independent' or (hints is not null and hints = 0));
alter table public.coding_attempts add column import_origin text;
alter table public.behavioral_stories add column import_origin text;
alter table public.coding_problems add column import_origin text;
create unique index coding_problems_import_origin_key on public.coding_problems(user_id,import_origin) where import_origin is not null;
create unique index coding_attempts_import_origin_key on public.coding_attempts(user_id,import_origin) where import_origin is not null;
create unique index behavioral_stories_import_origin_key on public.behavioral_stories(user_id,import_origin) where import_origin is not null;

create function public.history_problem_slug(value text) returns text
language sql immutable set search_path = '' as $$
 select substring(lower(value) from '^https?://(?:www\.)?leetcode\.com/problems/([a-z0-9-]+)(?:/|[?#]|$)')
$$;

-- Normalize defaults and types, not uncertainty. Null is distinct from zero.
create function public.history_attempt_content(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
 select jsonb_build_object(
 'attempted_on',(p->>'attempted_on')::date,'duration_minutes',(p->>'duration_minutes')::integer,
 'language',p->>'language','solution',coalesce(p->>'solution',''),'difficulty',p->>'difficulty',
 'pattern',p->>'pattern','assistance',p->>'assistance','hints',(p->>'hints')::integer,
 'correctness',p->>'correctness','test_results',coalesce(p->>'test_results',''),
 'time_complexity',coalesce(p->>'time_complexity',''),'space_complexity',coalesce(p->>'space_complexity',''),
 'confidence',(p->>'confidence')::integer,'notes',coalesce(p->>'notes',''))
$$;
create function public.history_story_content(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
 select jsonb_build_object('title',p->>'title',
 'principles',(select jsonb_agg(v order by v) from jsonb_array_elements(p->'principles') v),
 'situation',coalesce(p->>'situation',''),'task',coalesce(p->>'task',''),
 'action',coalesce(p->>'action',''),'result',coalesce(p->>'result',''),
 'evidence',coalesce(p->>'evidence',''),'follow_up_questions',coalesce(p->>'follow_up_questions',''),
 'confidence',(p->>'confidence')::integer,'status',p->>'status')
$$;

-- One implementation for preview and commit, under caller RLS. Preview executes
-- validation in a subtransaction and rolls it back, including evidence triggers.
create function public.import_history_safe(payload jsonb, dry_run boolean default true)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
 p jsonb; a jsonb; s jsonb; content jsonb; problem_map jsonb = '{}';
 matched public.coding_problems; matches integer; new_id uuid; origin text; slug text; number integer;
 pi integer = 0; pl integer = 0; ai integer = 0; askip integer = 0; si integer = 0; sskip integer = 0;
 warnings jsonb = '[]'; conflicts jsonb = '[]'; report jsonb; seen_ids jsonb = '{}';
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if dry_run is null then raise exception 'Choose preview or commit'; end if;
 if payload->'version' is distinct from '1'::jsonb then raise exception 'Unsupported version'; end if;
 if jsonb_typeof(payload->'problems') is distinct from 'array' or jsonb_typeof(payload->'attempts') is distinct from 'array' or jsonb_typeof(payload->'stories') is distinct from 'array' then raise exception 'Expected problems, attempts and stories arrays'; end if;
 if jsonb_array_length(payload->'problems')>2000 or jsonb_array_length(payload->'attempts')>10000 or jsonb_array_length(payload->'stories')>1000 then raise exception 'Import exceeds record limits'; end if;
 -- Serialize imports for this account, including simultaneous repeated uploads.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 begin
  for p in select value from jsonb_array_elements(payload->'problems') loop
   if coalesce(length(trim(p->>'source_id')),0) not between 1 and 200 then raise exception 'A problem source ID is required'; end if;
   if seen_ids ? (p->>'source_id') then raise exception 'Duplicate source ID'; end if;
   seen_ids = seen_ids || jsonb_build_object(p->>'source_id',true);
   number = (p->>'leetcode_id')::integer;
   if number is not null and number < 1 then raise exception 'Invalid LeetCode number'; end if;
   slug = public.history_problem_slug(p->>'url');
   origin = md5(jsonb_build_object('title',p->>'title','url',coalesce(p->>'url',''),'difficulty',p->>'difficulty','pattern',p->>'pattern','leetcode_id',number)::text);
   select count(*) into matches from public.coding_problems cp where cp.user_id=auth.uid() and
    (cp.import_origin=origin or (number is not null and cp.leetcode_id=number) or
     (slug is not null and public.history_problem_slug(cp.url)=slug) or
     (coalesce(p->>'url','')<>'' and cp.url=p->>'url'));
   if matches>1 then
    conflicts = conflicts || jsonb_build_array('Multiple library problems match ' || (p->>'title') || '. Resolve the duplicate identities before importing.');
    continue;
   end if;
   if matches=1 then
    select * into matched from public.coding_problems cp where cp.user_id=auth.uid() and
     (cp.import_origin=origin or (number is not null and cp.leetcode_id=number) or
      (slug is not null and public.history_problem_slug(cp.url)=slug) or
      (coalesce(p->>'url','')<>'' and cp.url=p->>'url'));
    if (number is not null and matched.leetcode_id is not null and number<>matched.leetcode_id) or
       (slug is not null and public.history_problem_slug(matched.url) is not null and slug<>public.history_problem_slug(matched.url)) then
     conflicts = conflicts || jsonb_build_array('Conflicting number and URL for ' || (p->>'title') || '.');
     continue;
    end if;
    new_id = matched.id;
    pl = pl+1;
    if lower(trim(matched.title))<>lower(trim(p->>'title')) or matched.pattern<>p->>'pattern' or matched.difficulty<>p->>'difficulty' then
     warnings = warnings || jsonb_build_array('Existing metadata kept for ' || (p->>'title') || ': title, pattern, or difficulty differs.');
    end if;
   else
    if exists(select 1 from public.coding_problems cp where cp.user_id=auth.uid() and lower(trim(cp.title))=lower(trim(p->>'title'))) then
     conflicts = conflicts || jsonb_build_array('An existing title matches ' || (p->>'title') || ' without a verified shared identity. Review its number or URL before importing.');
     continue;
    end if;
    insert into public.coding_problems(title,url,difficulty,pattern,leetcode_id,import_origin)
     values(p->>'title',coalesce(p->>'url',''),p->>'difficulty',p->>'pattern',number,origin) returning id into new_id;
    pi = pi+1;
   end if;
   problem_map = problem_map || jsonb_build_object(p->>'source_id',new_id);
  end loop;
  for a in select value from jsonb_array_elements(payload->'attempts') loop
   if not seen_ids ? (a->>'problem_source_id') then raise exception 'Unknown problem source'; end if;
   if not problem_map ? (a->>'problem_source_id') then continue; end if;
   new_id = (problem_map->>(a->>'problem_source_id'))::uuid;
   content = public.history_attempt_content(a->'data');
   origin = md5(new_id::text || ':' || content::text);
   if exists(select 1 from public.coding_attempts ca where ca.user_id=auth.uid() and
     (ca.import_origin=origin or (ca.problem_id=new_id and public.history_attempt_content(to_jsonb(ca))=content))) then
    askip = askip+1;
   else
    p = content;
    insert into public.coding_attempts(problem_id,attempted_on,duration_minutes,language,solution,difficulty,pattern,assistance,hints,correctness,test_results,time_complexity,space_complexity,confidence,notes,import_origin)
     values(new_id,(p->>'attempted_on')::date,(p->>'duration_minutes')::integer,p->>'language',p->>'solution',p->>'difficulty',p->>'pattern',p->>'assistance',(p->>'hints')::integer,p->>'correctness',p->>'test_results',p->>'time_complexity',p->>'space_complexity',(p->>'confidence')::integer,p->>'notes',origin);
    ai = ai+1;
   end if;
  end loop;
  for s in select value from jsonb_array_elements(payload->'stories') loop
   content = public.history_story_content(s);
   origin = md5(content::text);
   if exists(select 1 from public.behavioral_stories bs where bs.user_id=auth.uid() and
     (bs.import_origin=origin or public.history_story_content(to_jsonb(bs))=content)) then
    sskip = sskip+1;
   else
    insert into public.behavioral_stories(title,principles,situation,task,action,result,evidence,follow_up_questions,confidence,status,import_origin)
     values(s->>'title',array(select jsonb_array_elements_text(s->'principles')),coalesce(s->>'situation',''),coalesce(s->>'task',''),coalesce(s->>'action',''),coalesce(s->>'result',''),coalesce(s->>'evidence',''),coalesce(s->>'follow_up_questions',''),(s->>'confidence')::integer,s->>'status',origin);
    si = si+1;
   end if;
  end loop;
  report = jsonb_build_object('problems',jsonb_build_object('inserted',pi,'linked',pl),
   'attempts',jsonb_build_object('inserted',ai,'skipped',askip),'stories',jsonb_build_object('inserted',si,'skipped',sskip),
   'warnings',warnings,'conflicts',conflicts,'committed',not dry_run and jsonb_array_length(conflicts)=0);
  if dry_run or jsonb_array_length(conflicts)>0 then
   raise exception using errcode='LP001',message='Roll back import preview';
  end if;
 exception when sqlstate 'LP001' then null;
 end;
 return report;
end $$;

-- Keep older callers atomic and duplicate-safe, without changing their signature.
create or replace function public.import_history(payload jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
 result = public.import_history_safe(payload,false);
 if not (result->>'committed')::boolean then raise exception '%',result->'conflicts'; end if;
end $$;
revoke all on function public.history_problem_slug(text), public.history_attempt_content(jsonb), public.history_story_content(jsonb), public.import_history_safe(jsonb,boolean) from public;
grant execute on function public.history_problem_slug(text), public.history_attempt_content(jsonb), public.history_story_content(jsonb), public.import_history_safe(jsonb,boolean) to authenticated;
commit;
