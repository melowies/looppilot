-- Additive, opt-in adaptive planner. Existing history and migrations are untouched.
create table public.planner_state (
 user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
 config jsonb not null default '{}' check(jsonb_typeof(config)='object' and octet_length(config::text)<100000),
 revision bigint not null default 0 check(revision>=0)
);
create table public.study_plans (
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 day date not null, payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<300000),
 generated_at timestamptz not null default now(), primary key(user_id,day)
);
do $$ declare t text; begin
 foreach t in array array['planner_state','study_plans'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy own_rows on public.%I for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;

-- Durable per-account reservations enforce limits across workers and restarts.
create table public.planner_coach_requests (
 user_id uuid not null references auth.users(id) on delete cascade,
 cache_key text not null check(length(cache_key)=64), created_at timestamptz not null default now(),
 result jsonb check(result is null or (jsonb_typeof(result)='object' and octet_length(result::text)<10000)),
 primary key(user_id,cache_key)
);
alter table public.planner_coach_requests enable row level security;
create policy own_rows on public.planner_coach_requests for select to authenticated using ((select auth.uid())=user_id);
grant select on public.planner_coach_requests to authenticated;
create function public.reserve_planner_coach(cache_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached public.planner_coach_requests;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 perform 1 from public.planner_state where user_id=auth.uid() for update;
 if not exists(select 1 from public.planner_state where user_id=auth.uid() and config->>'aiConsent'='true') then raise exception 'Coaching consent required'; end if;
 select * into cached from public.planner_coach_requests r where r.user_id=auth.uid() and r.cache_key=reserve_planner_coach.cache_key;
 if cached.result is not null and cached.created_at>now()-interval '12 hours' then return jsonb_build_object('status','cached','result',cached.result); end if;
 if cached.user_id is not null then return jsonb_build_object('status','limited'); end if;
 if (select count(*) from public.planner_coach_requests where user_id=auth.uid() and created_at>=(now() at time zone 'UTC')::date at time zone 'UTC')>=5 or exists(select 1 from public.planner_coach_requests where user_id=auth.uid() and created_at>now()-interval '1 minute') then return jsonb_build_object('status','limited'); end if;
 insert into public.planner_coach_requests(user_id,cache_key) values(auth.uid(),reserve_planner_coach.cache_key);
 return jsonb_build_object('status','allowed');
end $$;
create function public.finish_planner_coach(cache_key text,result jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if not exists(select 1 from public.planner_state where user_id=auth.uid() and config->>'aiConsent'='true') then raise exception 'Coaching consent required'; end if;
 update public.planner_coach_requests r set result=finish_planner_coach.result where r.user_id=auth.uid() and r.cache_key=finish_planner_coach.cache_key and r.result is null;
end $$;
revoke all on function public.reserve_planner_coach(text),public.finish_planner_coach(text,jsonb) from public;
grant execute on function public.reserve_planner_coach(text),public.finish_planner_coach(text,jsonb) to authenticated;

-- Evidence changes invalidate plans across tabs/devices without modifying evidence.
create function public.touch_planner_evidence() returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid;
begin
 if tg_table_name='profiles' then owner_id=coalesce(new.id,old.id); else owner_id=coalesce(new.user_id,old.user_id); end if;
 if owner_id is null or not exists(select 1 from auth.users where id=owner_id) then return coalesce(new,old); end if;
 insert into public.planner_state(user_id,revision) values(owner_id,1)
 on conflict(user_id) do update set revision=public.planner_state.revision+1;
 return coalesce(new,old);
end $$;
do $$ declare t text; begin
 foreach t in array array['profiles','coding_problems','coding_attempts','behavioral_stories','study_sessions','daily_study_tasks','readiness_snapshots'] loop
  execute format('create trigger planner_evidence after insert or update or delete on public.%I for each row execute function public.touch_planner_evidence()',t);
 end loop;
end $$;

-- Choose the earlier real instant for an ambiguous wall time, matching the JS
-- scheduler. A spring-forward gap returns NULL, rather than shifting the round.
create function public.planner_wall_instant(d date,t text,zone text) returns timestamptz language sql stable set search_path='' as $$
 select min(s) from generate_series((d::timestamp at time zone 'UTC')-interval '14 hours',(d::timestamp at time zone 'UTC')+interval '38 hours',interval '1 minute') s
 where s at time zone zone=(d::text||' '||t)::timestamp
$$;

create function public.validate_planner_config(c jsonb) returns void language plpgsql set search_path='' as $$
declare windows jsonb; w jsonb; r jsonb; previous_end text; instant timestamptz;
begin
 if exists(select 1 from unnest(array['dailyMinutes','sessionMinutes','breakMinutes']) k where jsonb_typeof(c->k) is distinct from 'number') or exists(select 1 from unnest(array['foundations','focused','taper']) k where jsonb_typeof(c->'phaseDays'->k) is distinct from 'number') then raise exception 'Missing numeric preferences'; end if;
 if not exists(select 1 from pg_timezone_names where name=c->>'timezone') or not exists(select 1 from pg_timezone_names where name=c->>'interviewTimezone') then raise exception 'Invalid timezone'; end if;
 if jsonb_array_length(c->'weekly')<>7 or jsonb_typeof(c->'weekly')<>'array' or c->'weekly' is null then raise exception 'Seven weekdays required'; end if;
 if (c->>'dailyMinutes')::int not between 0 and 720 or (c->>'sessionMinutes')::int not between 15 and 90 or (c->>'breakMinutes')::int not between 5 and 30 or c->>'intensity' not in ('gentle','balanced','intensive') then raise exception 'Invalid session preferences'; end if;
 if c->>'dailyMinutes' is null or c->>'sessionMinutes' is null or c->>'breakMinutes' is null or c->>'intensity' is null or jsonb_typeof(c->'aiConsent') is distinct from 'boolean' then raise exception 'Missing preferences'; end if;
 if not ((c->'phaseDays'->>'foundations')::int between 8 and 120 and (c->'phaseDays'->>'focused')::int between 3 and 60 and (c->'phaseDays'->>'taper')::int between 1 and 3 and (c->'phaseDays'->>'foundations')::int>(c->'phaseDays'->>'focused')::int and (c->'phaseDays'->>'focused')::int>(c->'phaseDays'->>'taper')::int) or c->'phaseDays' is null then raise exception 'Invalid phase boundaries'; end if;
 if jsonb_typeof(c->'rounds') is distinct from 'array' or jsonb_typeof(c->'overrides') is distinct from 'array' or jsonb_typeof(c->'unavailable') is distinct from 'array' then raise exception 'Expected settings arrays'; end if;
 if jsonb_array_length(c->'rounds')>20 or jsonb_array_length(c->'overrides')>366 or jsonb_array_length(c->'unavailable')>100 then raise exception 'Settings exceed limits'; end if;
 if (select count(*)<>count(distinct x->>'date') from jsonb_array_elements(c->'overrides') x) or (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(c->'rounds') x) then raise exception 'Duplicate override or round'; end if;
 for windows in select value from jsonb_array_elements(c->'weekly') union all select value->'windows' from jsonb_array_elements(c->'overrides') loop
  if jsonb_typeof(windows) is distinct from 'array' or jsonb_array_length(windows)>6 then raise exception 'Invalid windows'; end if;
  previous_end='';
  for w in select value from jsonb_array_elements(windows) order by value->>'start' loop
   if coalesce(w->>'start','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(w->>'end','')!~'^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$' or w->>'end'<=w->>'start' or w->>'start'<previous_end then raise exception 'Invalid or overlapping availability windows'; end if;
   previous_end=w->>'end';
  end loop;
 end loop;
 for r in select value from jsonb_array_elements(c->'overrides') loop perform (r->>'date')::date; if r->>'date' is null then raise exception 'Override date required'; end if; end loop;
 for r in select value from jsonb_array_elements(c->'unavailable') loop
  if (r->>'end')::timestamptz<=(r->>'start')::timestamptz or r->>'start' is null or r->>'end' is null then raise exception 'Invalid unavailable period'; end if;
 end loop;
 for r in select value from jsonb_array_elements(c->'rounds') loop
  if exists(select 1 from unnest(array['id','title','date','time','duration','format']) k where r->>k is null) then raise exception 'Incomplete interview round'; end if;
  if coalesce(r->>'time','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or (r->>'duration')::int not between 15 and 480 or r->>'format' not in ('mixed','coding','behavioral') or coalesce(length(trim(r->>'title')),0) not between 1 and 200 or coalesce(length(r->>'id'),0) not between 1 and 80 then raise exception 'Invalid interview round'; end if;
  instant=public.planner_wall_instant((r->>'date')::date,r->>'time',c->>'interviewTimezone');
  if instant is null then raise exception 'Interview time does not exist in this timezone'; end if;
 end loop;
end $$;

-- Settings and plan edits use an optimistic revision, serialized per account.
create function public.save_planner_config(expected_revision bigint, settings jsonb) returns void language plpgsql security definer set search_path='' as $$
declare current_revision bigint;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 insert into public.planner_state(user_id) values(auth.uid()) on conflict do nothing;
 select revision into current_revision from public.planner_state where user_id=auth.uid() for update;
 if current_revision is distinct from expected_revision then raise exception 'Planner changed; refresh and try again' using errcode='40001'; end if;
 perform public.validate_planner_config(settings);
 update public.planner_state set config=settings,revision=revision+1 where user_id=auth.uid();
 insert into public.profiles(id,timezone,interview_date) values(auth.uid(),settings->>'timezone',(select min((r->>'date')::date) from jsonb_array_elements(settings->'rounds') r where ((r->>'date')::date)>=(now() at time zone (settings->>'interviewTimezone'))::date)) on conflict(id) do update set timezone=excluded.timezone,interview_date=coalesce(excluded.interview_date,public.profiles.interview_date);
end $$;

create function public.get_planner_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare state public.planner_state; p record; updated_items jsonb; changed boolean=false; initial_config jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 initial_config=jsonb_build_object('timezone',coalesce((select timezone from public.profiles where id=auth.uid()),'Europe/Istanbul'),'interviewTimezone','Europe/Istanbul','rounds','[]'::jsonb,'weekly','[[],[],[],[],[],[],[]]'::jsonb,'overrides','[]'::jsonb,'unavailable','[]'::jsonb,'dailyMinutes',120,'intensity','balanced','sessionMinutes',45,'breakMinutes',10,'phaseDays','{"foundations":21,"focused":7,"taper":2}'::jsonb,'aiConsent',false);
 insert into public.planner_state(user_id,config) values(auth.uid(),initial_config) on conflict do nothing;
 select * into state from public.planner_state where user_id=auth.uid() for update;
 if state.config='{}'::jsonb then update public.planner_state set config=initial_config where user_id=auth.uid() returning * into state; end if;
 -- Missing a session changes scheduling state only, never learning evidence.
 for p in select * from public.study_plans where user_id=auth.uid() and exists(select 1 from jsonb_array_elements(payload->'items') i where i->>'status'='planned' and (i->>'end')::timestamptz<=now()) loop
  select jsonb_agg(case when i->>'status'='planned' and (i->>'end')::timestamptz<=now() then jsonb_set(i,'{status}','"missed"') else i end order by n) into updated_items from jsonb_array_elements(p.payload->'items') with ordinality x(i,n);
  update public.study_plans set payload=jsonb_set(payload,'{items}',updated_items) where user_id=auth.uid() and day=p.day;
  changed=true;
 end loop;
 if changed then update public.planner_state set revision=revision+1 where user_id=auth.uid() returning * into state; end if;
 return jsonb_build_object('config',state.config,'revision',state.revision,'days',coalesce((select jsonb_agg(payload order by day) from public.study_plans where user_id=auth.uid()),'[]'::jsonb));
end $$;

create function public.validate_planner_day(p jsonb, c jsonb, old_payload jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare item jsonb; old_item jsonb; windows jsonb; point timestamptz; local_point timestamp; r jsonb; interview_start timestamptz;
begin
 if p->>'timezone' is distinct from coalesce(c->>'timezone','Europe/Istanbul') or coalesce(p->>'phase','') not in ('Foundations','Focused practice','Interview rehearsal','Light review') then raise exception 'Invalid plan timezone or phase'; end if;
 if exists(select 1 from unnest(array['availableMinutes','studyMinutes','overdue']) k where jsonb_typeof(p->k) is distinct from 'number' or (p->>k)::int<0) or jsonb_typeof(p->'baseline') is distinct from 'boolean' then raise exception 'Invalid plan metadata'; end if;
 if exists(select 1 from unnest(array['explanation','warnings','changes']) k where jsonb_typeof(p->k) is distinct from 'array') then raise exception 'Invalid plan explanations'; end if;
 if not (p ? 'daysRemaining') or (p->'daysRemaining'<>'null'::jsonb and (jsonb_typeof(p->'daysRemaining') is distinct from 'number' or (p->>'daysRemaining')::int<0)) or (p ? 'sourceRevision' and (jsonb_typeof(p->'sourceRevision') is distinct from 'number' or (p->>'sourceRevision')::bigint<0)) then raise exception 'Invalid plan metadata'; end if;
 if exists(select 1 from unnest(array['explanation','warnings','changes']) k cross join lateral jsonb_array_elements(p->k) v where jsonb_typeof(v) is distinct from 'string' or length(v#>>'{}')>3000) or jsonb_array_length(p->'explanation')>30 or jsonb_array_length(p->'warnings')>100 or jsonb_array_length(p->'changes')>30 then raise exception 'Invalid plan explanations'; end if;
 if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items')>100 or p->>'day' is null then raise exception 'Invalid plan'; end if;
 if (select count(*)<>count(distinct i->>'key') from jsonb_array_elements(p->'items') i) then raise exception 'Duplicate session identifiers'; end if;
 for old_item in select value from jsonb_array_elements(coalesce(old_payload->'items','[]')) loop
  if old_item->>'status'<>'planned' or (old_item->>'pinned')::boolean or (old_item->>'start')::timestamptz<now() then
   if not exists(select 1 from jsonb_array_elements(p->'items') i where i=old_item or ((old_item->>'status')='planned' and (old_item->>'end')::timestamptz<=now() and i=jsonb_set(old_item,'{status}','"missed"'))) then raise exception 'Completed, started, skipped and pinned sessions must be preserved'; end if;
  end if;
 end loop;
 for item in select value from jsonb_array_elements(p->'items') loop
  if exists(select 1 from jsonb_array_elements(coalesce(old_payload->'items','[]')) i where i=item) then continue; end if;
  if exists(select 1 from unnest(array['key','title','category','start','end','minutes','reason','priority','status','pinned']) k where item->>k is null) or coalesce(length(item->>'key'),0) not between 1 and 300 or length(item->>'reason')>3000 then raise exception 'Invalid session fields'; end if;
  if exists(select 1 from unnest(array['key','title','category','start','end','reason','status']) k where jsonb_typeof(item->k) is distinct from 'string') or exists(select 1 from unnest(array['problem_id','story_id','completed_at']) k where not (item ? k) or jsonb_typeof(item->k) not in ('string','null')) or jsonb_typeof(item->'minutes') is distinct from 'number' or jsonb_typeof(item->'priority') is distinct from 'number' then raise exception 'Invalid session field types'; end if;
  if item->>'start' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' or item->>'end' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then raise exception 'Session instants require explicit offsets'; end if;
  if item->>'key' is null or coalesce(length(item->>'title'),0) not between 1 and 300 or (item->>'minutes')::int not between 1 and 90 or (item->>'end')::timestamptz-(item->>'start')::timestamptz<>make_interval(mins=>(item->>'minutes')::int) or item->>'category' not in ('coding','review','behavioral','mock','debugging','break') or item->>'status' not in ('planned','completed','skipped','missed') or jsonb_typeof(item->'pinned') is distinct from 'boolean' then raise exception 'Invalid session'; end if;
  if ((item->>'status'='completed') <> (item->>'completed_at' is not null)) then raise exception 'Invalid completion state'; end if;
  if item->>'completed_at' is not null then perform (item->>'completed_at')::timestamptz; end if;
  if item->>'category'<>'break' and (item->>'minutes')::int>(c->>'sessionMinutes')::int then raise exception 'Session exceeds preferred length'; end if;
  if item->>'problem_id' is not null and not exists(select 1 from public.coding_problems where id=(item->>'problem_id')::uuid and user_id=auth.uid()) then raise exception 'Unknown problem'; end if;
  if item->>'story_id' is not null and not exists(select 1 from public.behavioral_stories where id=(item->>'story_id')::uuid and user_id=auth.uid()) then raise exception 'Unknown story'; end if;
  if item->>'status' in ('skipped','missed') then continue; end if;
  for r in select value from jsonb_array_elements(c->'rounds') loop
   interview_start=public.planner_wall_instant((r->>'date')::date,r->>'time',c->>'interviewTimezone');
   if ((item->>'start')::timestamptz<interview_start+make_interval(mins=>(r->>'duration')::int) and (item->>'end')::timestamptz>interview_start) or ((interview_start at time zone (c->>'timezone'))::date=(p->>'day')::date and (item->>'end')::timestamptz>interview_start) then raise exception 'Session overlaps or follows an interview on this date'; end if;
  end loop;
  -- Validate every real minute, including DST repeated/missing hours.
  for point in select generate_series((item->>'start')::timestamptz,(item->>'end')::timestamptz-interval '1 minute',interval '1 minute') loop
   local_point=point at time zone (c->>'timezone');
   if local_point::date<>(p->>'day')::date then raise exception 'Session crosses a study day'; end if;
   select o->'windows' into windows from jsonb_array_elements(c->'overrides') o where (o->>'date')::date=local_point::date;
   if windows is null then windows=c->'weekly'->extract(dow from local_point)::int; end if;
   if not exists(select 1 from jsonb_array_elements(windows) w where to_char(local_point,'HH24:MI')>=w->>'start' and to_char(local_point,'HH24:MI')<w->>'end') then raise exception 'Session outside availability'; end if;
   if exists(select 1 from jsonb_array_elements(c->'unavailable') b where point>=(b->>'start')::timestamptz and point<(b->>'end')::timestamptz) then raise exception 'Session in unavailable period'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p->'items') i where i->>'key'<>item->>'key' and i->>'status' not in ('skipped','missed') and (i->>'start')::timestamptz<(item->>'end')::timestamptz and (case when i->>'status'='completed' then greatest((i->>'start')::timestamptz,least((i->>'end')::timestamptz,(i->>'completed_at')::timestamptz)) else (i->>'end')::timestamptz end)>(item->>'start')::timestamptz) then raise exception 'Overlapping sessions'; end if;
  if item->>'category'<>'break' and exists(select 1 from jsonb_array_elements(p->'items') i where i->>'key'<>item->>'key' and i->>'category'<>'break' and i->>'status' not in ('skipped','missed') and (i->>'start')::timestamptz<(item->>'end')::timestamptz+make_interval(mins=>(c->>'breakMinutes')::int) and (case when i->>'status'='completed' then greatest((i->>'start')::timestamptz,least((i->>'end')::timestamptz,(i->>'completed_at')::timestamptz)) else (i->>'end')::timestamptz end)+make_interval(mins=>(c->>'breakMinutes')::int)>(item->>'start')::timestamptz) then raise exception 'Insufficient break between sessions'; end if;
 end loop;
 if (select coalesce(sum((i->>'minutes')::int),0) from jsonb_array_elements(p->'items') i where i->>'category'<>'break' and i->>'status' not in ('skipped','missed'))>greatest(coalesce((c->>'dailyMinutes')::int,0),(select coalesce(sum((i->>'minutes')::int),0) from jsonb_array_elements(coalesce(old_payload->'items','[]')) i where i->>'category'<>'break' and i->>'status' not in ('skipped','missed') and (i->>'status'='completed' or (i->>'pinned')::boolean or (i->>'start')::timestamptz<now()))) then raise exception 'Plan exceeds daily study cap'; end if;
end $$;

create function public.commit_planner_week(expected_revision bigint, days jsonb) returns void language plpgsql security definer set search_path='' as $$
declare state public.planner_state; p jsonb; old_payload jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into state from public.planner_state where user_id=auth.uid() for update;
 if state.user_id is null or state.revision is distinct from expected_revision then raise exception 'Planner changed; refresh and try again' using errcode='40001'; end if;
 if jsonb_typeof(days) is distinct from 'array' or jsonb_array_length(days)>7 then raise exception 'Expected up to seven plan days'; end if;
 for p in select value from jsonb_array_elements(days) loop
  select payload into old_payload from public.study_plans where user_id=auth.uid() and day=(p->>'day')::date;
  if (p->>'day')::date < (now() at time zone coalesce(state.config->>'timezone','Europe/Istanbul'))::date then raise exception 'Historical plans cannot be regenerated'; end if;
  perform public.validate_planner_day(p,state.config,old_payload);
  insert into public.study_plans(user_id,day,payload) values(auth.uid(),(p->>'day')::date,p)
  on conflict(user_id,day) do update set payload=excluded.payload,generated_at=now() where public.study_plans.payload is distinct from excluded.payload;
 end loop;
end $$;

create function public.edit_planner_item(expected_revision bigint, plan_day date, item_key text, action text, new_start timestamptz default null) returns void language plpgsql security definer set search_path='' as $$
declare state public.planner_state; p jsonb; item jsonb; updated_item jsonb; items jsonb; target_day date; target_payload jsonb; moved_item jsonb; target_key text;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into state from public.planner_state where user_id=auth.uid() for update;
 if state.user_id is null or state.revision is distinct from expected_revision then raise exception 'Planner changed; refresh and try again' using errcode='40001'; end if;
 select payload into p from public.study_plans where user_id=auth.uid() and day=plan_day for update;
 select i into item from jsonb_array_elements(p->'items') i where i->>'key'=item_key;
 if item is null or item->>'status'<>'planned' then raise exception 'Only planned sessions can be edited'; end if;
 updated_item=item;
 if action='complete' then updated_item=jsonb_set(jsonb_set(item,'{status}','"completed"'),'{completed_at}',to_jsonb(now()));
 elsif action='skip' then updated_item=jsonb_set(item,'{status}','"skipped"');
 elsif action='pin' then updated_item=jsonb_set(item,'{pinned}',to_jsonb(not (item->>'pinned')::boolean));
 elsif action='reschedule' then
  if new_start is null or new_start<now() then raise exception 'Choose a future start time'; end if;
  updated_item=item||jsonb_build_object('start',to_char(new_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'end',to_char((new_start+make_interval(mins=>(item->>'minutes')::int)) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'pinned',true);
  target_day=(new_start at time zone (state.config->>'timezone'))::date;
  if target_day<>plan_day then
   select payload into target_payload from public.study_plans where user_id=auth.uid() and day=target_day for update;
   if target_payload is null then raise exception 'Choose a date in the generated week'; end if;
   target_key=target_day::text||substring(item_key from 11);
   moved_item=jsonb_set(updated_item,'{key}',to_jsonb(target_key));
   items=coalesce((select jsonb_agg(i) from jsonb_array_elements(target_payload->'items') i where i->>'key'<>target_key),'[]'::jsonb)||jsonb_build_array(moved_item);
   perform public.validate_planner_day(jsonb_set(target_payload,'{items}',items),state.config,target_payload);
   update public.study_plans set payload=jsonb_set(payload,'{items}',items) where user_id=auth.uid() and day=target_day;
   updated_item=jsonb_set(item,'{status}','"skipped"');
  end if;
 else raise exception 'Unknown action'; end if;
 select jsonb_agg(case when i->>'key'=item_key then updated_item else i end order by n) into items from jsonb_array_elements(p->'items') with ordinality x(i,n);
 -- Explicit edits may change the selected protected item; all other sessions remain protected.
 if action='reschedule' then perform public.validate_planner_day(jsonb_set(p,'{items}',items),state.config,jsonb_set(p,'{items}',coalesce((select jsonb_agg(i) from jsonb_array_elements(p->'items') i where i->>'key'<>item_key),'[]'::jsonb))); end if;
 update public.study_plans set payload=jsonb_set(payload,'{items}',items) where user_id=auth.uid() and day=plan_day;
 update public.planner_state set revision=revision+1 where user_id=auth.uid();
end $$;

-- Table writes also run validation so direct REST callers cannot bypass integrity checks.
create function public.guard_planner_state() returns trigger language plpgsql set search_path='' as $$
begin
 if new.config<>'{}'::jsonb then perform public.validate_planner_config(new.config); end if;
 if tg_op='UPDATE' and new.config is distinct from old.config and new.revision<=old.revision then new.revision=old.revision+1; end if;
 return new;
end $$;
create trigger guard_planner_state before insert or update on public.planner_state for each row execute function public.guard_planner_state();
-- Authenticated clients have SELECT only; RPCs enforce owner and revision checks.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.proname in ('save_planner_config','get_planner_state','commit_planner_week','edit_planner_item','validate_planner_config','validate_planner_day','touch_planner_evidence','guard_planner_state','planner_wall_instant') loop
  execute format('revoke all on function %s from public',f.sig);
  execute format('grant execute on function %s to authenticated',f.sig);
 end loop;
end $$;
