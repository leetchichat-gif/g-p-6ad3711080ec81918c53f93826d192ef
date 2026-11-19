-- One Piece Stats Draft: each player fills eight character-stat categories.
-- Character draws are with replacement. Placing Blackbeard in Devil Fruit grants
-- that player the next character in Devil Fruit automatically.

alter type public.auction_mode add value if not exists 'one_piece_stats';

-- Add Teach if the installed One Piece catalog does not already contain him.
insert into public.one_piece_characters(character_id, display_name, search_name, display_order)
values ('blackbeard', 'Marshall D. Teach (Barbe Noire)', 'Blackbeard', 1000)
on conflict (character_id) do update
set display_name = excluded.display_name, search_name = excluded.search_name;

create table if not exists public.one_piece_stats_state (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  phase text not null default 'pick' check (phase in ('pick', 'finished')),
  pick_no integer not null default 1,
  active_player_id uuid not null references auth.users(id),
  forced_player_id uuid references auth.users(id),
  current_character_id text references public.one_piece_characters(character_id)
);

create table if not exists public.one_piece_stats_picks (
  room_id uuid not null references public.rooms(id) on delete cascade,
  pick_no integer not null,
  character_id text not null references public.one_piece_characters(character_id),
  owner_id uuid not null references auth.users(id),
  stat_key text not null check (stat_key in ('strength', 'speed', 'iq', 'resistance', 'devil_fruit', 'race', 'haki', 'weapon')),
  forced boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (room_id, pick_no)
);

-- A player fills each category once, except Devil Fruit may hold Teach plus the forced character.
create unique index if not exists one_piece_stats_one_per_category
  on public.one_piece_stats_picks(room_id, owner_id, stat_key)
  where stat_key <> 'devil_fruit';

alter table public.one_piece_stats_state enable row level security;
alter table public.one_piece_stats_picks enable row level security;
revoke all on public.one_piece_stats_state, public.one_piece_stats_picks from public, anon, authenticated;

create or replace function public.start_one_piece_stats_game(p_room uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $function$
declare r public.rooms; starters uuid[]; first_character text;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found then raise exception 'Salon introuvable'; end if;
  if not public.is_room_member(p_room) then raise exception 'Accès refusé'; end if;
  if r.mode::text <> 'one_piece_stats' then raise exception 'Ce salon n’est pas en mode One Piece Stats'; end if;
  if r.status <> 'waiting' then raise exception 'Partie déjà démarrée'; end if;
  if r.created_at < now() - interval '24 hours' then raise exception 'Ce salon a expiré (24 heures)'; end if;
  if (select count(*) from public.room_players where room_id = p_room) <> 2
     or exists (select 1 from public.room_players where room_id = p_room and not ready) then
    raise exception 'Deux joueurs prêts sont nécessaires';
  end if;
  select array_agg(user_id order by seat) into starters from public.room_players where room_id = p_room;
  select character_id into first_character from public.one_piece_characters order by random() limit 1;
  if first_character is null then raise exception 'Le catalogue One Piece est vide'; end if;
  insert into public.one_piece_stats_state(room_id, active_player_id, current_character_id)
  values (p_room, starters[1], first_character);
  update public.rooms set status = 'active', round_no = 0, updated_at = now() where id = p_room;
  insert into public.game_events(room_id, actor_id, event_type, detail)
  values (p_room, auth.uid(), 'one_piece_stats_started', jsonb_build_object('categories', 8, 'duplicates_allowed', true));
end
$function$;

create or replace function public.one_piece_stats_choose(p_room uuid, p_stat text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $function$
declare
  s public.one_piece_stats_state;
  next_character text;
  next_player uuid;
  next_forced_player uuid;
  player_a uuid;
  player_b uuid;
  done_a integer;
  done_b integer;
  is_forced boolean;
begin
  if not public.is_room_member(p_room) then raise exception 'Accès refusé'; end if;
  perform 1 from public.rooms where id = p_room and mode::text = 'one_piece_stats' and status = 'active' for update;
  if not found then raise exception 'Partie One Piece Stats indisponible'; end if;
  select * into s from public.one_piece_stats_state where room_id = p_room for update;
  if s.phase <> 'pick' or s.current_character_id is null then raise exception 'Aucun personnage à placer'; end if;
  if auth.uid() <> s.active_player_id then raise exception 'Ce n’est pas votre tour'; end if;

  is_forced := s.forced_player_id is not null;
  if is_forced then
    if s.forced_player_id <> auth.uid() then raise exception 'Cette attribution forcée ne vous appartient pas'; end if;
    if p_stat <> 'devil_fruit' then raise exception 'Le prochain personnage doit aller dans Fruit du démon'; end if;
  elsif p_stat not in ('strength', 'speed', 'iq', 'resistance', 'devil_fruit', 'race', 'haki', 'weapon') then
    raise exception 'Statistique invalide';
  elsif exists (
    select 1 from public.one_piece_stats_picks where room_id = p_room and owner_id = auth.uid() and stat_key = p_stat
  ) then
    raise exception 'Cette statistique est déjà remplie';
  end if;

  insert into public.one_piece_stats_picks(room_id, pick_no, character_id, owner_id, stat_key, forced)
  values (p_room, s.pick_no, s.current_character_id, auth.uid(), p_stat, is_forced);

  if s.current_character_id = 'blackbeard' and p_stat = 'devil_fruit' then
    -- A Teach drawn by the forced assignment chains the same rule.
    next_player := auth.uid();
    next_forced_player := auth.uid();
  elsif is_forced then
    select user_id into next_player from public.room_players where room_id = p_room and user_id <> auth.uid();
    next_forced_player := null;
  else
    select user_id into next_player from public.room_players where room_id = p_room and user_id <> auth.uid();
    next_forced_player := null;
  end if;

  select user_id into player_a from public.room_players where room_id = p_room order by seat limit 1;
  select user_id into player_b from public.room_players where room_id = p_room order by seat offset 1 limit 1;
  select count(distinct stat_key) into done_a from public.one_piece_stats_picks where room_id = p_room and owner_id = player_a;
  select count(distinct stat_key) into done_b from public.one_piece_stats_picks where room_id = p_room and owner_id = player_b;

  if done_a >= 8 and done_b >= 8 and next_forced_player is null then
    update public.one_piece_stats_state set phase = 'finished', pick_no = s.pick_no + 1,
      active_player_id = next_player, forced_player_id = null, current_character_id = null where room_id = p_room;
    update public.rooms set status = 'finished', updated_at = now() where id = p_room;
  else
    select character_id into next_character from public.one_piece_characters order by random() limit 1;
    update public.one_piece_stats_state set pick_no = s.pick_no + 1, active_player_id = next_player,
      forced_player_id = next_forced_player, current_character_id = next_character where room_id = p_room;
  end if;

  -- This mode has up to 17 placements, unlike the standard Pokémon room's 12 rounds.
  -- Keep rooms.round_no inside its existing 0..12 constraint; pick_no is the draft counter.
  update public.rooms set updated_at = now() where id = p_room;
  insert into public.game_events(room_id, actor_id, event_type, round_no, detail)
  values (p_room, auth.uid(), 'one_piece_stats_character_placed', s.pick_no,
    jsonb_build_object('character_id', s.current_character_id, 'owner_id', auth.uid(), 'stat_key', p_stat, 'forced', is_forced));
end
$function$;

create or replace function public.get_one_piece_stats_state(p_room uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $function$
declare s public.one_piece_stats_state; me uuid := auth.uid();
begin
  if not public.is_room_member(p_room) then raise exception 'Accès refusé'; end if;
  select * into s from public.one_piece_stats_state where room_id = p_room;
  if not found then raise exception 'Partie One Piece Stats introuvable'; end if;
  return jsonb_build_object(
    'phase', s.phase, 'pick_no', s.pick_no, 'active_player_id', s.active_player_id,
    'forced_player_id', s.forced_player_id, 'is_active_player', s.active_player_id = me,
    'is_forced_player', coalesce(s.forced_player_id = me, false),
    'current_character', case when s.phase = 'pick' then
      (select jsonb_build_object('id', c.character_id, 'name', c.display_name, 'search_name', c.search_name)
       from public.one_piece_characters c where c.character_id = s.current_character_id)
      else null end,
    'teams', (select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', p.user_id, 'nickname', p.nickname,
      'stats', jsonb_build_object(
        'strength', (select coalesce(jsonb_agg(jsonb_build_object('id', c.character_id, 'name', c.display_name, 'search_name', c.search_name) order by x.pick_no), '[]'::jsonb) from public.one_piece_stats_picks x join public.one_piece_characters c using (character_id) where x.room_id = p_room and x.owner_id = p.user_id and x.stat_key = 'strength'),
        'speed', (select coalesce(jsonb_agg(jsonb_build_object('id', c.character_id, 'name', c.display_name, 'search_name', c.search_name) order by x.pick_no), '[]'::jsonb) from public.one_piece_stats_picks x join public.one_piece_characters c using (character_id) where x.room_id = p_room and x.owner_id = p.user_id and x.stat_key = 'speed'),
        'iq', (select coalesce(jsonb_agg(jsonb_build_object('id', c.character_id, 'name', c.display_name, 'search_name', c.search_name) order by x.pick_no), '[]'::jsonb) from public.one_piece_stats_picks x join public.one_piece_characters c using (character_id) where x.room_id = p_room and x.owner_id = p.user_id and x.stat_key = 'iq'),
        'resistance', (select coalesce(jsonb_agg(jsonb_build_object('id', c.character_id, 'name', c.display_name, 'search_name', c.search_name) order by x.pick_no), '[]'::jsonb) from public.one_piece_stats_picks x join public.one_piece_characters c using (character_id) where x.room_id = p_room and x.owner_id = p.user_id and x.stat_key = 'resistance'),
        'devil_fruit', (select coalesce(jsonb_agg(jsonb_build_object('id', c.character_id, 'name', c.display_name, 'search_name', c.search_name, 'forced', x.forced) order by x.pick_no), '[]'::jsonb) from public.one_piece_stats_picks x join public.one_piece_characters c using (character_id) where x.room_id = p_room and x.owner_id = p.user_id and x.stat_key = 'devil_fruit'),
        'race', (select coalesce(jsonb_agg(jsonb_build_object('id', c.character_id, 'name', c.display_name, 'search_name', c.search_name) order by x.pick_no), '[]'::jsonb) from public.one_piece_stats_picks x join public.one_piece_characters c using (character_id) where x.room_id = p_room and x.owner_id = p.user_id and x.stat_key = 'race'),
        'haki', (select coalesce(jsonb_agg(jsonb_build_object('id', c.character_id, 'name', c.display_name, 'search_name', c.search_name) order by x.pick_no), '[]'::jsonb) from public.one_piece_stats_picks x join public.one_piece_characters c using (character_id) where x.room_id = p_room and x.owner_id = p.user_id and x.stat_key = 'haki'),
        'weapon', (select coalesce(jsonb_agg(jsonb_build_object('id', c.character_id, 'name', c.display_name, 'search_name', c.search_name) order by x.pick_no), '[]'::jsonb) from public.one_piece_stats_picks x join public.one_piece_characters c using (character_id) where x.room_id = p_room and x.owner_id = p.user_id and x.stat_key = 'weapon')
      )
    ) order by p.seat), '[]'::jsonb) from public.room_players p where p.room_id = p_room),
    'history', (select coalesce(jsonb_agg(jsonb_build_object(
      'pick_no', x.pick_no, 'id', c.character_id, 'name', c.display_name,
      'search_name', c.search_name, 'owner_id', x.owner_id, 'stat_key', x.stat_key, 'forced', x.forced
    ) order by x.pick_no desc), '[]'::jsonb)
      from public.one_piece_stats_picks x join public.one_piece_characters c using (character_id) where x.room_id = p_room)
  );
end
$function$;

revoke all on function public.start_one_piece_stats_game(uuid) from public, anon;
revoke all on function public.one_piece_stats_choose(uuid, text) from public, anon;
revoke all on function public.get_one_piece_stats_state(uuid) from public, anon;
grant execute on function public.start_one_piece_stats_game(uuid) to authenticated;
grant execute on function public.one_piece_stats_choose(uuid, text) to authenticated;
grant execute on function public.get_one_piece_stats_state(uuid) to authenticated;
