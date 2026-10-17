-- New matches use stored campus-wide paths. Existing active matches retain their original rules.
-- Pure polygon helper mirrors lib/geo.ts; geometry is frozen per match, not client-controlled.
create or replace function public.scram_in_area(f jsonb, arena jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare x float8:=(f->>'x')::float8; y float8:=(f->>'y')::float8;
 pts jsonb; a jsonb; b jsonb; exclusion jsonb; result boolean:=false; i int; j int;
 ax float8; ay float8; bx float8; by_ float8;
begin
 if f is null then return false; end if;
 if arena is null then return abs(x)<=140 and abs(y)<=30 and sqrt(x*x+y*y)>18; end if;
 pts:=arena->'boundary'; j:=jsonb_array_length(pts)-1;
 for i in 0..jsonb_array_length(pts)-1 loop
  a:=pts->i; b:=pts->j; ax:=(a->>'x')::float8; ay:=(a->>'y')::float8; bx:=(b->>'x')::float8; by_:=(b->>'y')::float8;
  if (ay>y)<>(by_>y) then
   if x<(bx-ax)*(y-ay)/(by_-ay)+ax then result:=not result; end if;
  end if; j:=i;
 end loop;
 if not result then return false; end if;
 for exclusion in select value from jsonb_array_elements(arena->'exclusions') loop
  if sqrt((x-(exclusion->'center'->>'x')::float8)^2+(y-(exclusion->'center'->>'y')::float8)^2)<=(exclusion->>'radius')::float8 then return false; end if;
 end loop;
 return true;
end;$$;
revoke all on function public.scram_in_area(jsonb,jsonb) from public,anon,authenticated;
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
  if m->'zones' is not null then
   radius:=(m->'zones'->phase->>'radius')::float8;
   cx:=(m->'zones'->phase->'center'->>'x')::float8;
   cy:=(m->'zones'->phase->'center'->>'y')::float8;
  end if;
  new_players:='[]'::jsonb;
  for p in select value from jsonb_array_elements(m->'players') loop
   if p->>'role'='runner' then
    f:=p->'fix'; fx:=(f->>'x')::float8; fy:=(f->>'y')::float8;
    outside:=f is null or at_ms-(f->>'at')::bigint>45000 or not public.scram_in_area(f,m->'arena') or sqrt((fx-cx)^2+(fy-cy)^2)>radius;
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
revoke all on function public.scram_tick(jsonb,bigint) from public,anon,authenticated;
-- Existing scram-match-clock automatically calls this upgraded implementation.
