-- Manual-only additive Live Study Companion RPCs; no source history is rewritten.
-- Session metadata lives in the existing owner-isolated study_plans payload.
create or replace function public.get_planner_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare state public.planner_state; p record; updated_items jsonb; changed boolean=false; initial_config jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 initial_config=jsonb_build_object('timezone',coalesce((select timezone from public.profiles where id=auth.uid()),'Europe/Istanbul'),'interviewTimezone','Europe/Istanbul','rounds','[]'::jsonb,'weekly','[[],[],[],[],[],[],[]]'::jsonb,'overrides','[]'::jsonb,'unavailable','[]'::jsonb,'dailyMinutes',120,'intensity','balanced','sessionMinutes',45,'breakMinutes',10,'phaseDays','{"foundations":21,"focused":7,"taper":2}'::jsonb,'aiConsent',false);
 insert into public.planner_state(user_id,config) values(auth.uid(),initial_config) on conflict do nothing;
 select * into state from public.planner_state where user_id=auth.uid() for update;
 if state.config='{}'::jsonb then update public.planner_state set config=initial_config where user_id=auth.uid() returning * into state; end if;
 for p in select * from public.study_plans where user_id=auth.uid() loop
  select coalesce(jsonb_agg(case when i->'live'->>'state'='running' and (i->'live'->>'heartbeat_at')::timestamptz<clock_timestamp()-interval '15 seconds' then jsonb_set(i,'{live,state}','"paused"') else i end order by n),'[]'::jsonb) into updated_items from jsonb_array_elements(p.payload->'items') with ordinality x(i,n);
  if updated_items is distinct from p.payload->'items' then
   update public.study_plans set payload=jsonb_set(payload,'{items}',updated_items) where user_id=auth.uid() and day=p.day; changed=true;
  end if;
 end loop;
 -- Missing a session changes scheduling state only, never learning evidence.
 for p in select * from public.study_plans where user_id=auth.uid() and exists(select 1 from jsonb_array_elements(payload->'items') i where i->>'status'='planned' and not (i ? 'live') and not (i->>'pinned')::boolean and (i->>'end')::timestamptz<=now()) loop
  select jsonb_agg(case when i->>'status'='planned' and not (i ? 'live') and not (i->>'pinned')::boolean and (i->>'end')::timestamptz<=now() then jsonb_set(i,'{status}','"missed"') else i end order by n) into updated_items from jsonb_array_elements(p.payload->'items') with ordinality x(i,n);
  update public.study_plans set payload=jsonb_set(payload,'{items}',updated_items) where user_id=auth.uid() and day=p.day;
  changed=true;
 end loop;
 if changed then update public.planner_state set revision=revision+1 where user_id=auth.uid() returning * into state; end if;
 return jsonb_build_object('config',state.config,'revision',state.revision,'days',coalesce((select jsonb_agg(payload order by day) from public.study_plans where user_id=auth.uid()),'[]'::jsonb));
end $$;

create function public.live_study_action(expected_revision bigint, plan_day date, item_key text, action text, owner_token text, observed_seconds numeric default 0) returns void
language plpgsql security definer set search_path='' as $$
declare s public.planner_state; p jsonb; item jsonb; updated_item jsonb; items jsonb; live jsonb; instant timestamptz=clock_timestamp(); delta numeric=0;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if owner_token is null or length(owner_token) not between 1 and 100 then raise exception 'Invalid tab identity'; end if;
 if observed_seconds is null or observed_seconds<0 or observed_seconds>15 or observed_seconds='NaN'::numeric then raise exception 'Invalid observed interval'; end if;
 select * into s from public.planner_state where user_id=auth.uid() for update;
 select payload into p from public.study_plans where user_id=auth.uid() and day=plan_day for update;
 select i into item from jsonb_array_elements(p->'items') i where i->>'key'=item_key;
 if item is null then raise exception 'Unknown study session'; end if;
 if action is null or action not in ('start','pause','resume','finish','skip','heartbeat','break_elapsed') then raise exception 'Unknown session action'; end if;
 -- Repeated terminal requests are harmless, even after another tab replans.
 if item->>'status' in ('completed','skipped') then return; end if;
 if item->>'status'<>'planned' then raise exception 'This session is no longer available'; end if;
 live=item->'live';
 if action='heartbeat' and (live->>'state' is distinct from 'running' or live->>'owner_token' is distinct from owner_token) then return; end if;
 if action not in ('heartbeat','break_elapsed') and s.revision is distinct from expected_revision then raise exception 'Planner changed; refresh and try again' using errcode='40001'; end if;
 if action in ('start','resume') then
  if exists(select 1 from public.study_plans sp cross join lateral jsonb_array_elements(sp.payload->'items') i where sp.user_id=auth.uid() and i->>'key'<>item_key and i->>'status'='planned' and i->'live'->>'state' in ('running','paused')) then raise exception 'Finish or skip your active session first'; end if;
  if live->>'state'='running' and live->>'owner_token'<>owner_token and (live->>'heartbeat_at')::timestamptz>instant-interval '15 seconds' then raise exception 'This session is running in another tab'; end if;
  if action='start' and live is not null then raise exception 'Resume this session instead'; end if;
  if action='resume' and live is null then raise exception 'Start this session first'; end if;
  if plan_day<>(instant at time zone (s.config->>'timezone'))::date and action='start' then raise exception 'Choose a session for today'; end if;
  if not exists(select 1 from jsonb_array_elements(coalesce((select o->'windows' from jsonb_array_elements(s.config->'overrides') o where o->>'date'=(instant at time zone (s.config->>'timezone'))::date::text),s.config->'weekly'->extract(dow from instant at time zone (s.config->>'timezone'))::int)) w where to_char(instant at time zone (s.config->>'timezone'),'HH24:MI')>=w->>'start' and to_char(instant at time zone (s.config->>'timezone'),'HH24:MI')<w->>'end')
   or exists(select 1 from jsonb_array_elements(s.config->'unavailable') b where instant>=(b->>'start')::timestamptz and instant<(b->>'end')::timestamptz)
   or exists(select 1 from jsonb_array_elements(s.config->'rounds') r where public.planner_wall_instant((r->>'date')::date,r->>'time',s.config->>'interviewTimezone')<=instant and (public.planner_wall_instant((r->>'date')::date,r->>'time',s.config->>'interviewTimezone') at time zone (s.config->>'timezone'))::date=(instant at time zone (s.config->>'timezone'))::date)
   or (jsonb_array_length(s.config->'rounds')=0 and exists(select 1 from public.profiles where id=auth.uid() and interview_date<=(instant at time zone (s.config->>'timezone'))::date))
   or (jsonb_array_length(s.config->'rounds')>0 and not exists(select 1 from jsonb_array_elements(s.config->'rounds') r where public.planner_wall_instant((r->>'date')::date,r->>'time',s.config->>'interviewTimezone')+make_interval(mins=>(r->>'duration')::int)>instant))
   then raise exception 'Outside your available study window'; end if;
  live=coalesce(live,jsonb_build_object('started_at',instant,'elapsed_seconds',0))||jsonb_build_object('state','running','heartbeat_at',instant,'owner_token',owner_token);
 else
  if live->>'state'='running' and live->>'owner_token'=owner_token and instant-(live->>'heartbeat_at')::timestamptz<=interval '15 seconds' then
   delta=least(observed_seconds,greatest(0,extract(epoch from instant-(live->>'heartbeat_at')::timestamptz)));
  end if;
  if live is not null then
   live=live||jsonb_build_object('elapsed_seconds',(live->>'elapsed_seconds')::numeric+delta,'heartbeat_at',instant);
   if action='heartbeat' and instant-(item->'live'->>'heartbeat_at')::timestamptz>interval '15 seconds' then live=jsonb_set(live,'{state}','"paused"'); end if;
   if action='pause' then live=jsonb_set(live,'{state}','"paused"'); end if;
  end if;
 end if;
 updated_item=item;
 if action='break_elapsed' then
  if item->>'category'<>'break' or live is null or live->>'state'<>'running' or live->>'owner_token'<>owner_token or (live->>'elapsed_seconds')::numeric<(item->>'minutes')::int*60 then return; end if;
 end if;
 if action in ('finish','break_elapsed') then
  updated_item=item||jsonb_build_object('status','completed','completed_at',instant);
  if live is not null then live=jsonb_set(live,'{state}','"finished"'); end if;
 elsif action='skip' then
  updated_item=jsonb_set(item,'{status}','"skipped"');
  if live is not null then live=jsonb_set(live,'{state}','"skipped"'); end if;
 end if;
 if live is not null then updated_item=jsonb_set(updated_item,'{live}',live); end if;
 select jsonb_agg(case when i->>'key'=item_key then updated_item else i end order by n) into items from jsonb_array_elements(p->'items') with ordinality x(i,n);
 update public.study_plans set payload=jsonb_set(payload,'{items}',items) where user_id=auth.uid() and day=plan_day;
 if action<>'heartbeat' or live->>'state'='paused' then update public.planner_state set revision=revision+1 where user_id=auth.uid(); end if;
end $$;

-- Only explicitly linked NEW workspace attempts can finish practice. Updates
-- must retain the original link; editing historical attempts cannot attach one.
create function public.complete_linked_study_attempt() returns trigger language plpgsql security definer set search_path='' as $$
declare evidence jsonb; link jsonb; p jsonb; item jsonb; items jsonb; rev bigint;
begin
 if new.user_id is distinct from auth.uid() then return new; end if;
 begin evidence=new.test_results::jsonb; exception when others then return new; end;
 if evidence->>'format' is distinct from 'looppilot-workspace-v1' then return new; end if;
 link=evidence->'studySession';
 if link is null then return new; end if;
 if tg_op='UPDATE' then
  begin
   if (old.test_results::jsonb)->'studySession' is distinct from link then return new; end if;
  exception when others then return new; end;
 end if;
 if new.correctness='unverified' then return new; end if;
 select revision into rev from public.planner_state where user_id=auth.uid() for update;
 begin
  select payload into p from public.study_plans where user_id=auth.uid() and day=(link->>'day')::date for update;
 exception when others then return new; end;
 select i into item from jsonb_array_elements(p->'items') i where i->>'key'=link->>'key';
 if item is null or item->>'status'<>'planned' or coalesce(item->'live'->>'state','') not in ('running','paused') or item->'live'->>'started_at' is distinct from link->>'startedAt'
  or item->>'problem_id' is distinct from new.problem_id::text or item->>'category' not in ('coding','review','debugging')
  or new.attempted_on<>(clock_timestamp() at time zone coalesce((select config->>'timezone' from public.planner_state where user_id=auth.uid()),'Europe/Istanbul'))::date
  then return new; end if;
 perform public.live_study_action(rev,(link->>'day')::date,link->>'key','finish',item->'live'->>'owner_token');
 select payload into p from public.study_plans where user_id=auth.uid() and day=(link->>'day')::date;
 select jsonb_agg(case when i->>'key'=link->>'key' then jsonb_set(i,'{live}',(i->'live')||jsonb_build_object('attempt_id',new.id,'outcome',new.correctness,'assistance',new.assistance,'duration_minutes',new.duration_minutes)) else i end order by n) into items from jsonb_array_elements(p->'items') with ordinality x(i,n);
 update public.study_plans set payload=jsonb_set(payload,'{items}',items) where user_id=auth.uid() and day=(link->>'day')::date;
 return new;
end $$;
create trigger complete_linked_study_attempt after insert or update on public.coding_attempts for each row execute function public.complete_linked_study_attempt();
revoke all on function public.live_study_action(bigint,date,text,text,text,numeric),public.complete_linked_study_attempt() from public;
grant execute on function public.live_study_action(bigint,date,text,text,text,numeric) to authenticated;

alter function public.edit_planner_item(bigint,date,text,text,timestamptz) rename to edit_planner_item_before_live;
revoke all on function public.edit_planner_item_before_live(bigint,date,text,text,timestamptz) from public,authenticated;
create function public.edit_planner_item(expected_revision bigint, plan_day date, item_key text, action text, new_start timestamptz default null) returns void language plpgsql security definer set search_path='' as $$
declare item jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 perform 1 from public.planner_state where user_id=auth.uid() for update;
 select i into item from public.study_plans sp cross join lateral jsonb_array_elements(sp.payload->'items') i where sp.user_id=auth.uid() and sp.day=plan_day and i->>'key'=item_key;
 if action in ('complete','skip') then
  perform public.live_study_action(expected_revision,plan_day,item_key,case when action='complete' then 'finish' else 'skip' end,coalesce(item->'live'->>'owner_token','manual'));
  return;
 end if;
 if item ? 'live' then raise exception 'Finish or skip this active session before moving or pinning it'; end if;
 perform public.edit_planner_item_before_live(expected_revision,plan_day,item_key,action,new_start);
end $$;
revoke all on function public.edit_planner_item(bigint,date,text,text,timestamptz) from public;
grant execute on function public.edit_planner_item(bigint,date,text,text,timestamptz) to authenticated;

-- Heartbeats do not invalidate evidence revisions. Merge their latest timing
-- under the same account lock so a simultaneous replan cannot reset a timer.
create or replace function public.commit_planner_week(expected_revision bigint, days jsonb) returns void language plpgsql security definer set search_path='' as $$
declare state public.planner_state; p jsonb; old_payload jsonb; merged_items jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into state from public.planner_state where user_id=auth.uid() for update;
 if state.user_id is null or state.revision is distinct from expected_revision then raise exception 'Planner changed; refresh and try again' using errcode='40001'; end if;
 if jsonb_typeof(days) is distinct from 'array' or jsonb_array_length(days)>7 then raise exception 'Expected up to seven plan days'; end if;
 for p in select value from jsonb_array_elements(days) loop
  select payload into old_payload from public.study_plans where user_id=auth.uid() and day=(p->>'day')::date;
  if (p->>'day')::date < (now() at time zone coalesce(state.config->>'timezone','Europe/Istanbul'))::date then raise exception 'Historical plans cannot be regenerated'; end if;
  select coalesce(jsonb_agg(case when old_item ? 'live' then jsonb_set(i,'{live}',old_item->'live') else i end order by n),'[]'::jsonb) into merged_items
   from jsonb_array_elements(p->'items') with ordinality x(i,n)
   left join lateral (select v as old_item from jsonb_array_elements(coalesce(old_payload->'items','[]')) v where v->>'key'=i->>'key') old_session on true;
  p=jsonb_set(p,'{items}',merged_items);
  perform public.validate_planner_day(p,state.config,old_payload);
  insert into public.study_plans(user_id,day,payload) values(auth.uid(),(p->>'day')::date,p)
  on conflict(user_id,day) do update set payload=excluded.payload,generated_at=now() where public.study_plans.payload is distinct from excluded.payload;
 end loop;
end $$;

create or replace function public.validate_planner_day(p jsonb, c jsonb, old_payload jsonb) returns void language plpgsql security invoker set search_path='' as $$
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
  if old_item->>'status'<>'planned' or (old_item->>'pinned')::boolean or old_item ? 'live' then
   if not exists(select 1 from jsonb_array_elements(p->'items') i where i=old_item or ((old_item->>'status')='planned' and (old_item->>'end')::timestamptz<=now() and i=jsonb_set(old_item,'{status}','"missed"'))) then raise exception 'Completed, started, skipped and pinned sessions must be preserved'; end if;
  end if;
 end loop;
 for item in select value from jsonb_array_elements(p->'items') loop
  if exists(select 1 from jsonb_array_elements(coalesce(old_payload->'items','[]')) i where i=item) then continue; end if;
  if item ? 'live' then raise exception 'Live session metadata must be written through session actions'; end if;
  if (item->>'start')::timestamptz<date_trunc('minute',clock_timestamp()) then raise exception 'New work cannot start in the past'; end if;
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
  if exists(select 1 from jsonb_array_elements(p->'items') i where i->>'key'<>item->>'key' and i->>'status' not in ('skipped','missed') and coalesce((i->'live'->>'started_at')::timestamptz,(i->>'start')::timestamptz)<(item->>'end')::timestamptz and (case when i->>'status'='completed' then greatest(coalesce((i->'live'->>'started_at')::timestamptz,(i->>'start')::timestamptz),(i->>'completed_at')::timestamptz) when i->'live'->>'state' in ('running','paused') then greatest((i->>'end')::timestamptz,clock_timestamp()) else (i->>'end')::timestamptz end)>(item->>'start')::timestamptz) then raise exception 'Overlapping sessions'; end if;
  if item->>'category'<>'break' and exists(select 1 from jsonb_array_elements(p->'items') i where i->>'key'<>item->>'key' and i->>'category'<>'break' and i->>'status' not in ('skipped','missed') and coalesce((i->'live'->>'started_at')::timestamptz,(i->>'start')::timestamptz)<(item->>'end')::timestamptz+make_interval(mins=>(c->>'breakMinutes')::int) and (case when i->>'status'='completed' then greatest(coalesce((i->'live'->>'started_at')::timestamptz,(i->>'start')::timestamptz),(i->>'completed_at')::timestamptz) when i->'live'->>'state' in ('running','paused') then greatest((i->>'end')::timestamptz,clock_timestamp()) else (i->>'end')::timestamptz end)+make_interval(mins=>(c->>'breakMinutes')::int)>(item->>'start')::timestamptz) then raise exception 'Insufficient break between sessions'; end if;
 end loop;
 if (select coalesce(sum(case when i->>'status'='completed' and i ? 'live' then (i->'live'->>'elapsed_seconds')::numeric/60 else (i->>'minutes')::numeric end),0) from jsonb_array_elements(p->'items') i where i->>'category'<>'break' and i->>'status' not in ('skipped','missed'))>greatest(coalesce((c->>'dailyMinutes')::int,0),(select coalesce(sum(case when i->>'status'='completed' and i ? 'live' then (i->'live'->>'elapsed_seconds')::numeric/60 else (i->>'minutes')::numeric end),0) from jsonb_array_elements(coalesce(old_payload->'items','[]')) i where i->>'category'<>'break' and i->>'status' not in ('skipped','missed') and (i->>'status'='completed' or (i->>'pinned')::boolean or (i->>'start')::timestamptz<now()))) then raise exception 'Plan exceeds daily study cap'; end if;
end $$;
