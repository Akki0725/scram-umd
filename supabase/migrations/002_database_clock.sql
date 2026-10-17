-- Vercel-compatible clock: all timing runs inside Postgres, independent of browsers.
-- Keep semantics aligned with lib/engine.ts; the parity suite executes both engines.
create or replace function public.scram_event(m jsonb, message text, at_ms bigint)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_set(m,'{events}',coalesce((select jsonb_agg(e) from (select e from jsonb_array_elements(jsonb_build_array(jsonb_build_object('text',message,'at',at_ms)) || coalesce(m->'events','[]'::jsonb)) with ordinality as items(e,n) order by n limit 24) s),'[]'::jsonb));
$$;
create or replace function public.scram_finish(m jsonb, at_ms bigint, why text)
returns jsonb language plpgsql immutable set search_path='' as $$
declare remaining jsonb; cleaned jsonb;
begin
 select coalesce(jsonb_agg(p),'[]'::jsonb) into remaining from jsonb_array_elements(m->'players') p where p->>'role'='runner';
 m:=m || jsonb_build_object('status','finished','reason',why,'pings','[]'::jsonb,'pickups','[]'::jsonb);
 if jsonb_array_length(remaining)=1 and why='Last runner standing' then m:=m || jsonb_build_object('winner',remaining->0->>'id'); end if;
 select coalesce(jsonb_agg(p-'fix'-'previousFix'),'[]'::jsonb) into cleaned from jsonb_array_elements(m->'players') p;
 m:=jsonb_set(m,'{players}',cleaned);
 return public.scram_event(m,why,at_ms);
end;$$;
create or replace function public.scram_tick(m jsonb, now_ms bigint)
returns jsonb language plpgsql immutable set search_path='' as $$
declare last_second int; i int; at_ms bigint; phase int; radius float8; damage int; cx float8; cy float8;
 p jsonb; f jsonb; new_players jsonb; new_pings jsonb; hp int; outside boolean; runners int;
 fx float8; fy float8; original_tick int;
begin
 if m->>'status'<>'active' or m->>'start' is null then return m; end if;
 last_second:=least(floor((now_ms-(m->>'start')::bigint)/1000.0)::int,2400);
 original_tick:=coalesce((m->>'tick')::int,0);
 if last_second<=original_tick then return m; end if;
 for i in original_tick+1..last_second loop
  at_ms:=(m->>'start')::bigint+i*1000::bigint;
  phase:=least(5,i/300);
  radius:=(array[150,125,100,75,45,22])[phase+1];
  damage:=(array[1,2,5,8,10,10])[phase+1];
  cx:=(m->'final'->>'x')::float8*phase/5; cy:=(m->'final'->>'y')::float8*phase/5;
  new_players:='[]'::jsonb;
  for p in select value from jsonb_array_elements(m->'players') loop
   if p->>'role'='runner' then
    f:=p->'fix'; fx:=(f->>'x')::float8; fy:=(f->>'y')::float8;
    outside:=f is null or at_ms-(f->>'at')::bigint>45000 or abs(fx)>140 or abs(fy)>30 or sqrt(fx*fx+fy*fy)<=18 or sqrt((fx-cx)^2+(fy-cy)^2)>radius;
    if outside then
     hp:=greatest(0,(p->>'hp')::int-damage);
     p:=jsonb_set(p,'{hp}',to_jsonb(hp));
     if hp=0 then
      if (p->>'life')::boolean then
       p:=p || '{"life":false,"hp":100}'::jsonb;
       m:=public.scram_event(m,(p->>'name')||' used an extra life',at_ms);
      else
       p:=jsonb_set(p,'{role}','"hunter"'::jsonb);
       m:=public.scram_event(m,(p->>'name')||' joined the hunt · storm',at_ms);
      end if;
     end if;
    end if;
   end if;
   new_players:=new_players || jsonb_build_array(p);
  end loop;
  m:=jsonb_set(m,'{players}',new_players);
  if i>=120 and (i-120)%60=0 then
   -- floor(x + .5) matches JavaScript Math.round, including negative grid coordinates.
   select coalesce(jsonb_agg(jsonb_build_object('id',q->>'id','name',q->>'name','x',floor((q->'fix'->>'x')::float8/40+.5)*40,'y',floor((q->'fix'->>'y')::float8/40+.5)*40,'at',at_ms)),'[]'::jsonb)
   into new_pings from jsonb_array_elements(m->'players') q where q->>'role'='runner' and q->'fix' is not null and at_ms-(q->'fix'->>'at')::bigint<=45000;
   m:=m || jsonb_build_object('pings',new_pings,'lastPing',at_ms);
   m:=public.scram_event(m,'Runner locations pinged · ~40 m grid',at_ms);
  end if;
  select count(*) into runners from jsonb_array_elements(m->'players') q where q->>'role'='runner';
  if runners<=1 then
   m:=public.scram_finish(m,at_ms,case when runners=1 then 'Last runner standing' else 'No runners survived' end);
   m:=jsonb_set(m,'{tick}',to_jsonb(least(last_second,i-1)));
   exit;
  end if;
  m:=jsonb_set(m,'{tick}',to_jsonb(i));
 end loop;
 m:=jsonb_set(m,'{updated}',to_jsonb(now_ms));
 if m->>'status'='active' and last_second>=2400 then m:=public.scram_finish(m,now_ms,'Time limit · match drawn'); end if;
 return m;
end;$$;
create or replace function public.scram_clock()
returns void language plpgsql security definer set search_path='' as $$
declare row record; next_state jsonb; now_ms bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
begin
 -- A recent heartbeat is required by the application before a real match can start.
 insert into public.scram_worker(id,at) values(1,clock_timestamp()) on conflict(id) do update set at=excluded.at;
 for row in select id,version,state from public.scram_state where state->>'status'='active' for update skip locked loop
  next_state:=public.scram_tick(row.state,now_ms);
  if next_state is distinct from row.state then perform public.scram_commit(row.id,row.version,next_state); end if;
 end loop;
end;$$;
revoke all on function public.scram_event(jsonb,text,bigint) from public,anon,authenticated;
revoke all on function public.scram_finish(jsonb,bigint,text) from public,anon,authenticated;
revoke all on function public.scram_tick(jsonb,bigint) from public,anon,authenticated;
revoke all on function public.scram_clock() from public,anon,authenticated;
grant execute on function public.scram_clock() to service_role;
-- Scheduling is separate from the pure functions so tests can load them without pg_cron.
select cron.schedule('scram-match-clock','1 second','select public.scram_clock();');
-- Bound only SCRAM's own scheduler logs, never other projects' or jobs' history.
select cron.schedule('scram-clock-log-retention','17 * * * *',$$delete from cron.job_run_details where jobid in(select jobid from cron.job where jobname in('scram-match-clock','scram-private-cleanup','scram-clock-log-retention')) and end_time<now()-interval '1 day';$$);
