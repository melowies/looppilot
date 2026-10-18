-- Apply once in the Supabase SQL editor or with supabase db push.
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '' check (length(display_name)<=200),
 interview_date date, timezone text not null default 'Europe/Istanbul'
);
create table public.coding_problems (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 title text not null check(length(trim(title)) between 1 and 200), url text not null default '' check(url='' or url ~ '^https?://'),
 difficulty text not null check(difficulty in ('Easy','Medium','Hard')),
 pattern text not null check(pattern in ('Arrays & hashing','Two pointers','Sliding window','Stack','Binary search','Linked lists','Trees','Graphs','Heaps','Backtracking','Dynamic programming','Intervals')),
 created_at timestamptz not null default now(), unique(id,user_id)
);
create table public.coding_attempts (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 problem_id uuid not null, attempted_on date not null,
 duration_minutes integer check(duration_minutes between 0 and 1440),
 language text not null check(length(trim(language)) between 1 and 200), solution text not null default '',
 difficulty text not null check(difficulty in ('Easy','Medium','Hard')),
 pattern text not null check(pattern in ('Arrays & hashing','Two pointers','Sliding window','Stack','Binary search','Linked lists','Trees','Graphs','Heaps','Backtracking','Dynamic programming','Intervals')),
 assistance text not null check(assistance in ('independent','hinted','guided','solution-viewed')),
 hints integer not null default 0 check(hints between 0 and 100),
 correctness text not null check(correctness in ('passed','partial','failed','unverified')),
 test_results text not null default '', time_complexity text not null default '', space_complexity text not null default '',
 confidence integer not null check(confidence between 1 and 5), notes text not null default '',
 check(assistance<>'independent' or hints=0),
 foreign key(problem_id,user_id) references public.coding_problems(id,user_id) on delete cascade
);
create table public.behavioral_stories (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 title text not null check(length(trim(title)) between 1 and 200), principles text[] not null check(cardinality(principles)>0 and principles <@ array['Customer Obsession','Ownership','Invent and Simplify','Are Right, A Lot','Learn and Be Curious','Hire and Develop the Best','Insist on the Highest Standards','Think Big','Bias for Action','Frugality','Earn Trust','Dive Deep','Have Backbone; Disagree and Commit','Deliver Results','Strive to be Earth’s Best Employer','Success and Scale Bring Broad Responsibility']::text[]),
 situation text not null default '', task text not null default '', action text not null default '', result text not null default '', evidence text not null default '', follow_up_questions text not null default '',
 confidence integer not null check(confidence between 1 and 5), status text not null check(status in ('draft','practicing','ready')),
 updated_at timestamptz not null default now(),
 check(status<>'ready' or (length(trim(situation))>0 and length(trim(task))>0 and length(trim(action))>0 and length(trim(result))>0))
);
create table public.study_sessions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 studied_on date not null, duration_minutes integer not null check(duration_minutes between 1 and 1440),
 focus text not null check(length(trim(focus)) between 1 and 200), notes text not null default ''
);
create table public.daily_study_tasks (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 problem_id uuid, recommendation_key text not null, title text not null, reason text not null, due_on date not null,
 status text not null default 'planned' check(status in ('planned','completed')), completed_at timestamptz,
 check((status='completed')=(completed_at is not null)),
 foreign key(problem_id,user_id) references public.coding_problems(id,user_id) on delete cascade,
 unique(user_id,recommendation_key)
);
create table public.readiness_snapshots (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 recorded_at timestamptz not null default now(), score integer not null check(score between 0 and 100),
 evidence jsonb not null, formula_version integer not null default 1
);
do $$ declare t text; begin
 foreach t in array array['profiles','coding_problems','coding_attempts','behavioral_stories','study_sessions','daily_study_tasks','readiness_snapshots'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy own_rows on public.%I for all to authenticated using ((select auth.uid()) = %I) with check ((select auth.uid()) = %I)',t,case when t='profiles' then 'id' else 'user_id' end,case when t='profiles' then 'id' else 'user_id' end);
 execute format('grant select, insert, update, delete on public.%I to authenticated',t);
 if t<>'profiles' then execute format('create index on public.%I(user_id)',t); end if;
 end loop;
end $$;
create index on public.coding_attempts(problem_id,attempted_on desc);
create index on public.daily_study_tasks(user_id,due_on);

-- Atomic import: no partial histories, no supplied user IDs, invoker RLS remains active.
create function public.import_history(payload jsonb) returns void language plpgsql security invoker set search_path = '' as $$
declare p jsonb; a jsonb; s jsonb; problem_map jsonb='{}'; new_id uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if payload->'version' is distinct from '1'::jsonb then raise exception 'Unsupported version'; end if;
 if jsonb_typeof(payload->'problems') is distinct from 'array' or jsonb_typeof(payload->'attempts') is distinct from 'array' or jsonb_typeof(payload->'stories') is distinct from 'array' then raise exception 'Expected problems, attempts and stories arrays'; end if;
 if jsonb_array_length(payload->'problems')>2000 or jsonb_array_length(payload->'attempts')>10000 or jsonb_array_length(payload->'stories')>1000 then raise exception 'Import exceeds record limits'; end if;
 for p in select value from jsonb_array_elements(payload->'problems') loop
  if problem_map ? (p->>'source_id') then raise exception 'Duplicate source ID'; end if;
  insert into public.coding_problems(title,url,difficulty,pattern) values(p->>'title',coalesce(p->>'url',''),p->>'difficulty',p->>'pattern') returning id into new_id;
  problem_map=jsonb_set(problem_map,array[p->>'source_id'],to_jsonb(new_id::text));
 end loop;
 for a in select value from jsonb_array_elements(payload->'attempts') loop
  if not problem_map ? (a->>'problem_source_id') then raise exception 'Unknown problem source'; end if;
  p=a->'data';
  insert into public.coding_attempts(problem_id,attempted_on,duration_minutes,language,solution,difficulty,pattern,assistance,hints,correctness,test_results,time_complexity,space_complexity,confidence,notes)
  values((problem_map->>(a->>'problem_source_id'))::uuid,(p->>'attempted_on')::date,(p->>'duration_minutes')::integer,p->>'language',coalesce(p->>'solution',''),p->>'difficulty',p->>'pattern',p->>'assistance',(p->>'hints')::integer,p->>'correctness',coalesce(p->>'test_results',''),coalesce(p->>'time_complexity',''),coalesce(p->>'space_complexity',''),(p->>'confidence')::integer,coalesce(p->>'notes',''));
 end loop;
 for s in select value from jsonb_array_elements(payload->'stories') loop
  insert into public.behavioral_stories(title,principles,situation,task,action,result,evidence,follow_up_questions,confidence,status)
  values(s->>'title',array(select jsonb_array_elements_text(s->'principles')),coalesce(s->>'situation',''),coalesce(s->>'task',''),coalesce(s->>'action',''),coalesce(s->>'result',''),coalesce(s->>'evidence',''),coalesce(s->>'follow_up_questions',''),(s->>'confidence')::integer,s->>'status');
 end loop;
end $$;
revoke all on function public.import_history(jsonb) from public;
grant execute on function public.import_history(jsonb) to authenticated;
