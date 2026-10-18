-- Additive only: no existing problems, attempts, or applied migrations are changed.
alter table public.coding_problems
 add column leetcode_id integer check (leetcode_id between 1 and 2147483647),
 add column topic_tags text[] not null default '{}';
comment on column public.coding_problems.leetcode_id is 'Displayed LeetCode frontend problem number, not its internal question ID.';
create unique index coding_problems_user_leetcode_id_key
 on public.coding_problems(user_id,leetcode_id) where leetcode_id is not null;
