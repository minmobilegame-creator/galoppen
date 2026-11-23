-- Galoppen multiplayer: rum, spillere, highscores.
-- Klienter logger ind anonymt (Supabase Auth) og får dermed et auth.uid().
-- Alle point går gennem record_score(), som validerer dem på serveren.

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z2-9]{4}$'),
  status text not null default 'lobby' check (status in ('lobby', 'playing', 'finished')),
  host_id uuid not null references auth.users (id) on delete cascade,
  target int not null default 20,
  started_at timestamptz,
  winner_seat int,
  winner_name text,
  finished_ms int,
  created_at timestamptz not null default now()
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade, -- null = computerspiller
  seat int not null check (seat between 1 and 4),
  name text not null check (char_length(name) between 1 and 16),
  is_ai boolean not null default false,
  ready boolean not null default false,
  score int not null default 0 check (score between 0 and 20),
  last_score_at timestamptz,
  created_at timestamptz not null default now(),
  unique (room_id, seat),
  unique (room_id, user_id)
);
create index players_room_idx on public.players (room_id);
create index players_user_idx on public.players (user_id);

create table public.highscores (
  id uuid primary key default gen_random_uuid(),
  player_name text not null,
  time_ms int not null check (time_ms > 0),
  user_id uuid references auth.users (id) on delete set null,
  room_id uuid references public.rooms (id) on delete set null,
  created_at timestamptz not null default now()
);
create index highscores_time_idx on public.highscores (time_ms);
create index highscores_user_idx on public.highscores (user_id);
create index highscores_room_idx on public.highscores (room_id);
create index rooms_host_idx on public.rooms (host_id);

-- ------------------------------------------------------------------ RLS

alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.highscores enable row level security;

create policy "rum kan læses af indloggede" on public.rooms
  for select to authenticated using (true);

create policy "spillere kan læses af indloggede" on public.players
  for select to authenticated using (true);

-- En spiller må kun opdatere sin egen række, og kun navn og klar-status (se grants nedenfor).
create policy "spiller opdaterer egen række" on public.players
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "spiller forlader selv rummet" on public.players
  for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "highscores er offentlige" on public.highscores
  for select to anon, authenticated using (true);

-- Kolonnerettigheder: point, plads osv. kan kun ændres af funktionerne nedenfor.
revoke insert, update, delete on public.rooms, public.players, public.highscores from anon, authenticated;
grant update (name, ready) on public.players to authenticated;
grant delete on public.players to authenticated;

-- ------------------------------------------------------------------ funktioner

create or replace function public.server_time()
returns timestamptz language sql stable set search_path = '' as $$ select now() $$;

create or replace function public.create_room(p_name text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_room uuid;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if v_uid is null then raise exception 'ikke logget ind'; end if;
  loop
    v_code := '';
    for i in 1..4 loop
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    end loop;
    exit when not exists (select 1 from public.rooms where code = v_code);
  end loop;
  insert into public.rooms (code, host_id) values (v_code, v_uid) returning id into v_room;
  insert into public.players (room_id, user_id, seat, name)
    values (v_room, v_uid, 1, left(coalesce(nullif(trim(p_name), ''), 'Spiller'), 16));
  return v_code;
end $$;

create or replace function public.join_room(p_code text, p_name text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms;
  v_seat int;
begin
  if v_uid is null then raise exception 'ikke logget ind'; end if;
  select * into v_room from public.rooms where code = upper(trim(p_code)) for update;
  if not found then raise exception 'rummet findes ikke'; end if;
  if exists (select 1 from public.players where room_id = v_room.id and user_id = v_uid) then
    return v_room.id;
  end if;
  if v_room.status <> 'lobby' then raise exception 'spillet er allerede i gang'; end if;
  select s into v_seat from generate_series(1, 4) s
    where not exists (select 1 from public.players p where p.room_id = v_room.id and p.seat = s)
    order by s limit 1;
  if v_seat is null then raise exception 'rummet er fuldt'; end if;
  insert into public.players (room_id, user_id, seat, name)
    values (v_room.id, v_uid, v_seat, left(coalesce(nullif(trim(p_name), ''), 'Spiller'), 16));
  return v_room.id;
end $$;

-- Værten starter, når alle menneskelige spillere er klar. Tomme pladser bliver computerspillere.
create or replace function public.start_game(p_room uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_room public.rooms;
  v_names text[] := array['Lyn', 'Storm', 'Tordenbrag', 'Hvirvelvind'];
  v_i int := 1;
  s int;
begin
  select * into v_room from public.rooms where id = p_room for update;
  if not found then raise exception 'rummet findes ikke'; end if;
  if v_room.host_id <> auth.uid() then raise exception 'kun værten kan starte'; end if;
  if v_room.status <> 'lobby' then raise exception 'spillet er allerede startet'; end if;
  if exists (select 1 from public.players where room_id = p_room and not is_ai and not ready) then
    raise exception 'alle spillere skal være klar';
  end if;
  for s in 1..4 loop
    if not exists (select 1 from public.players where room_id = p_room and seat = s) then
      insert into public.players (room_id, user_id, seat, name, is_ai, ready)
        values (p_room, null, s, v_names[v_i], true, true);
      v_i := v_i + 1;
    end if;
  end loop;
  update public.players set score = 0, last_score_at = null where room_id = p_room;
  update public.rooms set status = 'playing', started_at = now() where id = p_room;
end $$;

-- Den eneste vej til point. Validerer på serveren:
--  * rummet er i gang, og point er 1, 2 eller 3
--  * kalderen ejer pladsen (eller er vært og pladsen er en computerspiller)
--  * mindst 0,5 s siden sidste point for spilleren
--  * scoren kan ikke vokse hurtigere end et menneske med to kugler kan (3 + 2 point pr. sekund)
-- Den første, der når målet, vinder; rækkelåsen på rummet sikrer én vinder.
create or replace function public.record_score(p_room uuid, p_points int, p_seat int default null)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms;
  v_player public.players;
  v_elapsed double precision;
  v_new int;
begin
  if v_uid is null then raise exception 'ikke logget ind'; end if;
  if p_points not in (1, 2, 3) then raise exception 'ugyldige point'; end if;

  select * into v_room from public.rooms where id = p_room for update;
  if not found or v_room.status <> 'playing' then raise exception 'spillet kører ikke'; end if;

  if p_seat is null then
    select * into v_player from public.players where room_id = p_room and user_id = v_uid for update;
  else
    if v_room.host_id <> v_uid then raise exception 'kun værten styrer computerspillere'; end if;
    select * into v_player from public.players where room_id = p_room and seat = p_seat and is_ai for update;
  end if;
  if not found then raise exception 'ingen sådan spiller'; end if;

  if v_player.last_score_at is not null and now() - v_player.last_score_at < interval '500 milliseconds' then
    raise exception 'for hurtigt';
  end if;
  v_elapsed := extract(epoch from now() - v_room.started_at);
  v_new := least(v_room.target, v_player.score + p_points);
  if v_new > 3 + floor(v_elapsed * 2) then raise exception 'urealistisk hurtig scoring'; end if;

  update public.players set score = v_new, last_score_at = now() where id = v_player.id;

  if v_new >= v_room.target then
    update public.rooms
      set status = 'finished', winner_seat = v_player.seat, winner_name = v_player.name,
          finished_ms = (v_elapsed * 1000)::int
      where id = p_room;
    if not v_player.is_ai then
      insert into public.highscores (player_name, time_ms, user_id, room_id)
        values (v_player.name, (v_elapsed * 1000)::int, v_player.user_id, p_room);
    end if;
  end if;
  return v_new;
end $$;

-- Værten kan sende rummet tilbage til lobbyen for et nyt spil.
create or replace function public.reset_room(p_room uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.rooms where id = p_room and host_id = auth.uid()) then
    raise exception 'kun værten kan nulstille';
  end if;
  delete from public.players where room_id = p_room and is_ai;
  update public.players set score = 0, ready = false, last_score_at = null where room_id = p_room;
  update public.rooms set status = 'lobby', started_at = null, winner_seat = null,
    winner_name = null, finished_ms = null where id = p_room;
end $$;

revoke execute on function public.create_room(text), public.join_room(text, text), public.start_game(uuid),
  public.record_score(uuid, int, int), public.reset_room(uuid), public.server_time() from public, anon;
grant execute on function public.create_room(text), public.join_room(text, text), public.start_game(uuid),
  public.record_score(uuid, int, int), public.reset_room(uuid), public.server_time() to authenticated;

-- ------------------------------------------------------------------ realtime

alter publication supabase_realtime add table public.rooms, public.players;
