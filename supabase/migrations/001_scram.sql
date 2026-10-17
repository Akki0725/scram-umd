-- Run in a new Supabase project. Only the trusted server uses these write functions.
create table public.scram_state(id text primary key, version bigint not null default 0, state jsonb not null, updated_at timestamptz not null default now());
alter table public.scram_state enable row level security;
revoke all on public.scram_state from anon, authenticated;
create table public.scram_members(match_id text references public.scram_state(id) on delete cascade, user_id uuid references auth.users(id) on delete cascade, expires_at timestamptz not null, primary key(match_id,user_id));
alter table public.scram_members enable row level security;
create policy own_membership on public.scram_members for select to authenticated using(user_id=auth.uid() and expires_at>now());
grant select on public.scram_members to authenticated;
create table public.scram_signals(id text primary key references public.scram_state(id) on delete cascade, version bigint not null);
alter table public.scram_signals enable row level security;
create policy participant_signals on public.scram_signals for select to authenticated using(exists(select 1 from public.scram_members m where m.match_id=id and m.user_id=auth.uid() and m.expires_at>now()));
grant select on public.scram_signals to authenticated;
alter publication supabase_realtime add table public.scram_signals;
create table public.scram_worker(id int primary key check(id=1),at timestamptz not null);
alter table public.scram_worker enable row level security;
revoke all on public.scram_worker from anon,authenticated;
create table public.scram_buckets(key text primary key, window_start timestamptz not null, count int not null);
alter table public.scram_buckets enable row level security;
revoke all on public.scram_buckets from anon,authenticated;
create or replace function public.scram_limit(bucket text,maximum int,window_seconds int) returns boolean language plpgsql security definer set search_path='' as $$
declare hits int;
begin
 insert into public.scram_buckets as b(key,window_start,count) values(bucket,now(),1)
 on conflict(key) do update set count=case when b.window_start < now()-make_interval(secs=>window_seconds) then 1 else b.count+1 end,window_start=case when b.window_start < now()-make_interval(secs=>window_seconds) then now() else b.window_start end returning count into hits;
 return hits<=maximum;
end;$$;
create or replace function public.scram_commit(match_id text,expected_version bigint,new_state jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare changed int;
begin
 if expected_version=-1 then
 insert into public.scram_state(id,version,state) values(match_id,0,new_state) on conflict do nothing;
 else
 update public.scram_state set version=version+1,state=new_state,updated_at=now() where id=match_id and version=expected_version;
 end if;
 get diagnostics changed=row_count;
 if changed=0 then return false; end if;
 -- Synchronize membership and sanitized revision in the same transaction as game state.
 delete from public.scram_members where scram_members.match_id=scram_commit.match_id and user_id::text not in(select p->>'id' from jsonb_array_elements(new_state->'players') p);
 insert into public.scram_members(match_id,user_id,expires_at)
 select scram_commit.match_id,(p->>'id')::uuid,to_timestamp((new_state->>'created')::double precision/1000)+interval '1 hour' from jsonb_array_elements(new_state->'players') p on conflict do nothing;
 insert into public.scram_signals(id,version) values(match_id,expected_version+1) on conflict(id) do update set version=excluded.version;
 return true;
end;$$;
revoke all on function public.scram_commit(text,bigint,jsonb) from public,anon,authenticated;
revoke all on function public.scram_limit(text,int,int) from public,anon,authenticated;
grant execute on function public.scram_commit(text,bigint,jsonb) to service_role;
grant execute on function public.scram_limit(text,int,int) to service_role;
grant all on public.scram_state, public.scram_members, public.scram_signals, public.scram_worker, public.scram_buckets to service_role;
-- Privacy cleanup continues without the app worker. Enable pg_cron in Supabase Extensions.
create extension if not exists pg_cron;
select cron.schedule('scram-private-cleanup','* * * * *', $$delete from public.scram_state where (state->>'created')::double precision < extract(epoch from now()-interval '1 hour')*1000; delete from public.scram_buckets where window_start<now()-interval '2 hours';$$);
