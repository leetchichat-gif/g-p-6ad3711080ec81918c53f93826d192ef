-- Read-only spectators and one optional room administrator.
-- The passcode is kept in Vercel server-side configuration, never in SQL or browser code.

create table if not exists public.room_spectators (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null,
  role text not null default 'spectator' check (role in ('spectator', 'admin')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create unique index if not exists room_spectators_one_admin
  on public.room_spectators(room_id) where role = 'admin';

create table if not exists public.room_admin_unlock_attempts (
  room_id uuid not null references public.rooms(id) on delete cascade,
  client_fingerprint text not null,
  last_user_id uuid not null references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  primary key (room_id, client_fingerprint)
);

alter table public.room_spectators enable row level security;
alter table public.room_admin_unlock_attempts enable row level security;
revoke all on public.room_spectators, public.room_admin_unlock_attempts from public, anon, authenticated;

create or replace function public.join_room_as_spectator(p_code text, p_nickname text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare r public.rooms;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if length(trim(p_nickname)) not between 2 and 20 then raise exception 'Pseudo : 2 à 20 caractères'; end if;

  select * into r from public.rooms where code = upper(trim(p_code)) for update;
  if not found or r.status = 'abandoned' then raise exception 'Salon introuvable ou indisponible'; end if;
  if r.created_at < now() - interval '24 hours' and r.status = 'waiting' then raise exception 'Ce salon a expiré (24 heures)'; end if;
  if exists (select 1 from public.room_players where room_id = r.id and user_id = auth.uid()) then
    raise exception 'Un joueur ne peut pas rejoindre le même salon comme spectateur';
  end if;
  if not exists (select 1 from public.room_spectators where room_id = r.id and user_id = auth.uid())
     and (select count(*) from public.room_spectators where room_id = r.id) >= 20 then
    raise exception 'Ce salon a atteint sa limite de 20 spectateurs';
  end if;

  insert into public.profiles(user_id, nickname) values (auth.uid(), trim(p_nickname))
  on conflict (user_id) do update set nickname = excluded.nickname;
  insert into public.room_spectators(room_id, user_id, nickname)
  values (r.id, auth.uid(), trim(p_nickname))
  on conflict (room_id, user_id) do update set nickname = excluded.nickname;
  insert into public.game_events(room_id, actor_id, event_type) values (r.id, auth.uid(), 'spectator_joined');
  return r.id;
end
$function$;

create or replace function public.leave_room_as_spectator(p_room uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  delete from public.room_spectators where room_id = p_room and user_id = auth.uid();
  if found then
    insert into public.game_events(room_id, actor_id, event_type) values (p_room, auth.uid(), 'spectator_left');
  end if;
end
$function$;

create or replace function public.get_spectator_room_state(p_room uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare r public.rooms; a public.game_rounds; v_role text;
begin
  select role into v_role from public.room_spectators where room_id = p_room and user_id = auth.uid();
  if v_role is null then raise exception 'Accès refusé'; end if;
  select * into r from public.rooms where id = p_room;
  if not found then raise exception 'Salon introuvable'; end if;
  if r.round_no > 0 then
    select * into a from public.game_rounds where room_id = p_room and round_no = r.round_no;
  end if;

  return jsonb_build_object(
    'user_id', auth.uid(), 'role', v_role,
    'room', jsonb_build_object(
      'id', r.id, 'code', r.code, 'status', r.status, 'mode', r.mode,
      'round_no', r.round_no, 'round_total', r.round_total,
      'deadline_at', a.deadline_at, 'current_price', a.current_price,
      'current_pokemon', case when a.id is not null then (
        select jsonb_build_object(
          'id', c.pokemon_id, 'national_dex', c.national_dex,
          'display_name', c.display_name, 'form', c.form, 'types', c.types,
          'sprite', c.sprite_url, 'weight_kg', c.weight_kg
        ) from public.pokemon_catalog c where c.pokemon_id = a.pokemon_id
      ) else null end
    ),
    'players', (select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', p.user_id, 'nickname', p.nickname, 'seat', p.seat,
      'ready', p.ready, 'budget', p.budget
    ) order by p.seat), '[]'::jsonb) from public.room_players p where p.room_id = p_room),
    'spectator_count', (select count(*) from public.room_spectators s where s.room_id = p_room)
  );
end
$function$;

create or replace function public.consume_room_admin_attempt(p_room uuid, p_user uuid, p_fingerprint text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_attempts integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Accès réservé au serveur'; end if;
  if not exists (select 1 from public.room_spectators where room_id = p_room and user_id = p_user and role = 'spectator') then
    return false;
  end if;

  insert into public.room_admin_unlock_attempts(room_id, client_fingerprint, last_user_id, window_started_at, attempts)
  values (p_room, p_fingerprint, p_user, now(), 1)
  on conflict (room_id, client_fingerprint) do update
    set attempts = case
          when public.room_admin_unlock_attempts.window_started_at < now() - interval '15 minutes' then 1
          else public.room_admin_unlock_attempts.attempts + 1
        end,
        last_user_id = excluded.last_user_id,
        window_started_at = case
          when public.room_admin_unlock_attempts.window_started_at < now() - interval '15 minutes' then now()
          else public.room_admin_unlock_attempts.window_started_at
        end
  returning attempts into v_attempts;
  return v_attempts <= 5;
end
$function$;

create or replace function public.promote_spectator_to_admin(p_room uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.role() <> 'service_role' then raise exception 'Accès réservé au serveur'; end if;
  if not exists (select 1 from public.room_spectators where room_id = p_room and user_id = p_user and role = 'spectator') then
    raise exception 'Le compte doit d’abord rejoindre comme spectateur';
  end if;
  if exists (select 1 from public.room_spectators where room_id = p_room and role = 'admin' and user_id <> p_user) then
    raise exception 'Un administrateur est déjà présent dans ce salon';
  end if;
  update public.room_spectators set role = 'admin' where room_id = p_room and user_id = p_user;
  insert into public.game_events(room_id, actor_id, event_type)
  values (p_room, p_user, 'spectator_promoted_to_admin');
end
$function$;

create or replace function public.search_spectator_pokemon(p_room uuid, p_query text default '')
returns table (pokemon_id text, national_dex integer, display_name text, form text, types text[], sprite_url text)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not exists (select 1 from public.room_spectators where room_id = p_room and user_id = auth.uid() and role = 'admin') then
    raise exception 'Action réservée à l’administrateur';
  end if;
  return query
  select c.pokemon_id, c.national_dex, c.display_name, c.form, c.types, c.sprite_url
  from public.pokemon_catalog c
  where c.eligible
    and not exists (
      select 1 from public.game_rounds g
      where g.room_id = p_room and g.pokemon_id = c.pokemon_id
        and g.round_no <> (select r.round_no from public.rooms r where r.id = p_room)
    )
    and (coalesce(trim(p_query), '') = '' or c.display_name ilike '%' || trim(p_query) || '%'
         or c.national_dex::text = trim(p_query) or c.pokemon_id ilike '%' || trim(p_query) || '%')
  order by c.national_dex, c.display_name
  limit 30;
end
$function$;

create or replace function public.admin_change_current_pokemon(p_room uuid, p_pokemon_id text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare r public.rooms; a public.game_rounds; chosen text; old_pokemon text; result jsonb;
begin
  if not exists (select 1 from public.room_spectators where room_id = p_room and user_id = auth.uid() and role = 'admin') then
    raise exception 'Action réservée à l’administrateur';
  end if;
  select * into r from public.rooms where id = p_room for update;
  if not found or r.status <> 'active' then raise exception 'La partie doit être en cours'; end if;
  select * into a from public.game_rounds where room_id = p_room and round_no = r.round_no for update;
  if not found or a.status <> 'active' then raise exception 'Aucun lot actif'; end if;
  if a.current_price <> 0 or a.current_bidder_id is not null or exists (
    select 1 from public.public_bids b where b.room_id = p_room and b.round_no = r.round_no
  ) then raise exception 'Le Pokémon ne peut plus changer après la première mise'; end if;

  old_pokemon := a.pokemon_id;
  if p_pokemon_id is null then
    select c.pokemon_id into chosen from public.pokemon_catalog c
    where c.eligible and c.pokemon_id <> old_pokemon
      and not exists (select 1 from public.game_rounds g where g.room_id = p_room and g.pokemon_id = c.pokemon_id and g.round_no <> r.round_no)
    order by random() limit 1;
  else
    select c.pokemon_id into chosen from public.pokemon_catalog c
    where c.pokemon_id = p_pokemon_id and c.eligible
      and not exists (select 1 from public.game_rounds g where g.room_id = p_room and g.pokemon_id = c.pokemon_id and g.round_no <> r.round_no);
  end if;
  if chosen is null then raise exception 'Aucun Pokémon éligible et non utilisé ne correspond'; end if;

  update public.game_rounds set pokemon_id = chosen where id = a.id;
  -- A pending private clue must be re-rolled for the newly selected species.
  delete from public.round_clue_rolls where room_id = p_room and round_no = r.round_no;
  insert into public.game_events(room_id, actor_id, event_type, round_no, detail)
  values (p_room, auth.uid(), 'admin_changed_pokemon', r.round_no,
          jsonb_build_object('old_pokemon', old_pokemon, 'new_pokemon', chosen));
  select jsonb_build_object('id', c.pokemon_id, 'national_dex', c.national_dex,
    'display_name', c.display_name, 'form', c.form, 'types', c.types,
    'sprite', c.sprite_url, 'weight_kg', c.weight_kg)
  into result from public.pokemon_catalog c where c.pokemon_id = chosen;
  update public.rooms set updated_at = now() where id = p_room;
  return result;
end
$function$;

revoke all on function public.join_room_as_spectator(text, text), public.leave_room_as_spectator(uuid),
  public.get_spectator_room_state(uuid), public.search_spectator_pokemon(uuid, text),
  public.admin_change_current_pokemon(uuid, text), public.consume_room_admin_attempt(uuid, uuid, text),
  public.promote_spectator_to_admin(uuid, uuid) from public, anon;
grant execute on function public.join_room_as_spectator(text, text), public.leave_room_as_spectator(uuid),
  public.get_spectator_room_state(uuid), public.search_spectator_pokemon(uuid, text),
  public.admin_change_current_pokemon(uuid, text) to authenticated;
revoke all on function public.consume_room_admin_attempt(uuid, uuid, text), public.promote_spectator_to_admin(uuid, uuid)
  from authenticated;
grant execute on function public.consume_room_admin_attempt(uuid, uuid, text), public.promote_spectator_to_admin(uuid, uuid)
  to service_role;
