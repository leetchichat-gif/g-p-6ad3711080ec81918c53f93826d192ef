-- Keep each evolutionary family to one Pokemon per game.
-- Family values are stable text keys so regional forms can share a family.

alter table public.pokemon_catalog
  add column if not exists evolution_family text;

create or replace function public.set_default_pokemon_evolution_family()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.evolution_family is null or btrim(new.evolution_family) = '' then
    new.evolution_family := new.pokemon_id;
  end if;
  return new;
end
$function$;

update public.pokemon_catalog
set evolution_family = pokemon_id
where evolution_family is null or btrim(evolution_family) = '';

drop trigger if exists pokemon_catalog_default_evolution_family on public.pokemon_catalog;
create trigger pokemon_catalog_default_evolution_family
before insert or update of pokemon_id, evolution_family on public.pokemon_catalog
for each row execute function public.set_default_pokemon_evolution_family();

alter table public.pokemon_catalog
  alter column evolution_family set not null;

-- Generation VII families and Alolan forms in the current catalog.
-- Include the earlier family members too, so future catalog additions can
-- use the same family key without changing these game rules.
update public.pokemon_catalog as c
set evolution_family = f.family_key
from (values
  ('722', 'evo-722'), ('723', 'evo-722'), ('724', 'evo-722'),
  ('725', 'evo-725'), ('726', 'evo-725'), ('727', 'evo-725'),
  ('728', 'evo-728'), ('729', 'evo-728'), ('730', 'evo-728'),
  ('731', 'evo-731'), ('732', 'evo-731'), ('733', 'evo-731'),
  ('734', 'evo-734'), ('735', 'evo-734'),
  ('736', 'evo-736'), ('737', 'evo-736'), ('738', 'evo-736'),
  ('739', 'evo-739'), ('740', 'evo-739'),
  ('742', 'evo-742'), ('743', 'evo-742'),
  ('744', 'evo-744'), ('745', 'evo-744'),
  ('747', 'evo-747'), ('748', 'evo-747'),
  ('749', 'evo-749'), ('750', 'evo-749'),
  ('751', 'evo-751'), ('752', 'evo-751'),
  ('753', 'evo-753'), ('754', 'evo-753'),
  ('755', 'evo-755'), ('756', 'evo-755'),
  ('757', 'evo-757'), ('758', 'evo-757'),
  ('759', 'evo-759'), ('760', 'evo-759'),
  ('761', 'evo-761'), ('762', 'evo-761'), ('763', 'evo-761'),
  ('767', 'evo-767'), ('768', 'evo-767'),
  ('769', 'evo-769'), ('770', 'evo-769'),
  ('782', 'evo-782'), ('783', 'evo-782'), ('784', 'evo-782'),
  ('789', 'evo-789'), ('790', 'evo-789'), ('791', 'evo-789'), ('792', 'evo-789'),
  ('803', 'evo-803'), ('804', 'evo-803'),
  ('808', 'evo-808'), ('809', 'evo-808'),

  -- Pichu, Pikachu, Raichu and the Alolan Raichu form.
  ('172', 'evo-172'), ('25', 'evo-172'), ('26', 'evo-172'), ('26-alola', 'evo-172'),
  -- Magby, Magmar and Magmortar (supported if these species are added later).
  ('240', 'evo-240'), ('126', 'evo-240'), ('467', 'evo-240'),
  -- Alolan families, including their matching base forms.
  ('19', 'evo-19'), ('20', 'evo-19'), ('19-alola', 'evo-19'), ('20-alola', 'evo-19'),
  ('27', 'evo-27'), ('28', 'evo-27'), ('27-alola', 'evo-27'), ('28-alola', 'evo-27'),
  ('37', 'evo-37'), ('38', 'evo-37'), ('37-alola', 'evo-37'), ('38-alola', 'evo-37'),
  ('50', 'evo-50'), ('51', 'evo-50'), ('50-alola', 'evo-50'), ('51-alola', 'evo-50'),
  ('52', 'evo-52'), ('53', 'evo-52'), ('52-alola', 'evo-52'), ('53-alola', 'evo-52'),
  ('74', 'evo-74'), ('75', 'evo-74'), ('76', 'evo-74'),
  ('74-alola', 'evo-74'), ('75-alola', 'evo-74'), ('76-alola', 'evo-74'),
  ('88', 'evo-88'), ('89', 'evo-88'), ('88-alola', 'evo-88'), ('89-alola', 'evo-88'),
  ('102', 'evo-102'), ('103', 'evo-102'), ('103-alola', 'evo-102'),
  ('104', 'evo-104'), ('105', 'evo-104'), ('105-alola', 'evo-104')
) as f(pokemon_id, family_key)
where c.pokemon_id = f.pokemon_id;

create or replace function public.start_game(p_room uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  r public.rooms;
  p record;
  starters uuid[];
  i integer := 0;
begin
  select * into r from public.rooms where id = p_room for update;
  if not public.is_room_member(p_room) then raise exception 'Accès refusé'; end if;
  if r.status <> 'waiting' then raise exception 'Partie déjà démarrée'; end if;
  if r.created_at < now() - interval '24 hours' then raise exception 'Ce salon a expiré (24 heures)'; end if;
  if (select count(*) from public.room_players where room_id = p_room) <> 2
     or exists (select 1 from public.room_players where room_id = p_room and not ready) then
    raise exception 'Deux joueurs prêts sont nécessaires';
  end if;
  if (select count(distinct evolution_family) from public.pokemon_catalog
      where eligible and scope in ('gen7-introduced', 'alola-forms')) < 12 then
    raise exception 'Le catalogue éligible doit contenir au moins 12 familles de Pokémon';
  end if;

  select array_agg(user_id order by seat) into starters
  from public.room_players where room_id = p_room;

  for p in
    select pokemon_id
    from (
      select c.pokemon_id,
        row_number() over (partition by c.evolution_family order by random()) as family_pick
      from public.pokemon_catalog c
      where c.eligible and c.scope in ('gen7-introduced', 'alola-forms')
    ) as one_per_family
    where family_pick = 1
    order by random()
    limit 12
  loop
    i := i + 1;
    insert into public.game_rounds(
      room_id, round_no, pokemon_id, status, starter_user_id,
      current_turn_user_id, deadline_at
    ) values (
      p_room, i, p.pokemon_id,
      case when i = 1 then 'active' else 'pending' end,
      starters[case when i % 2 = 1 then 1 else 2 end],
      case when i = 1 then starters[1] else null end,
      case when i = 1 then now() + make_interval(secs => r.turn_seconds) else null end
    );
  end loop;

  update public.rooms set status = 'active', round_no = 1, updated_at = now()
  where id = p_room;
  insert into public.game_events(room_id, actor_id, event_type, round_no)
  values (p_room, auth.uid(), 'game_started', 1);
end
$function$;

create or replace function public.search_spectator_pokemon(p_room uuid, p_query text default '')
returns table (pokemon_id text, national_dex integer, display_name text, form text, types text[], sprite_url text)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not exists (
    select 1 from public.room_spectators
    where room_id = p_room and user_id = auth.uid() and role = 'admin'
  ) then raise exception 'Action réservée à l’administrateur'; end if;

  return query
  select c.pokemon_id, c.national_dex, c.display_name, c.form, c.types, c.sprite_url
  from public.pokemon_catalog c
  where c.eligible
    and not exists (
      select 1
      from public.game_rounds g
      join public.pokemon_catalog used on used.pokemon_id = g.pokemon_id
      where g.room_id = p_room
        and g.round_no <> (select r.round_no from public.rooms r where r.id = p_room)
        and used.evolution_family = c.evolution_family
    )
    and (coalesce(trim(p_query), '') = ''
      or c.display_name ilike '%' || trim(p_query) || '%'
      or c.national_dex::text = trim(p_query)
      or c.pokemon_id ilike '%' || trim(p_query) || '%')
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
declare
  r public.rooms;
  a public.game_rounds;
  chosen text;
  old_pokemon text;
  result jsonb;
begin
  if not exists (
    select 1 from public.room_spectators
    where room_id = p_room and user_id = auth.uid() and role = 'admin'
  ) then raise exception 'Action réservée à l’administrateur'; end if;

  select * into r from public.rooms where id = p_room for update;
  if not found or r.status <> 'active' then raise exception 'La partie doit être en cours'; end if;
  select * into a from public.game_rounds
  where room_id = p_room and round_no = r.round_no for update;
  if not found or a.status <> 'active' then raise exception 'Aucun lot actif'; end if;
  if a.current_price <> 0 or a.current_bidder_id is not null or exists (
    select 1 from public.public_bids b where b.room_id = p_room and b.round_no = r.round_no
  ) then raise exception 'Le Pokémon ne peut plus changer après la première mise'; end if;

  old_pokemon := a.pokemon_id;
  if p_pokemon_id is null then
    select c.pokemon_id into chosen
    from public.pokemon_catalog c
    where c.eligible and c.pokemon_id <> old_pokemon
      and not exists (
        select 1
        from public.game_rounds g
        join public.pokemon_catalog used on used.pokemon_id = g.pokemon_id
        where g.room_id = p_room and g.round_no <> r.round_no
          and used.evolution_family = c.evolution_family
      )
    order by random()
    limit 1;
  else
    select c.pokemon_id into chosen
    from public.pokemon_catalog c
    where c.pokemon_id = p_pokemon_id and c.eligible
      and not exists (
        select 1
        from public.game_rounds g
        join public.pokemon_catalog used on used.pokemon_id = g.pokemon_id
        where g.room_id = p_room and g.round_no <> r.round_no
          and used.evolution_family = c.evolution_family
      );
  end if;
  if chosen is null then raise exception 'Aucun Pokémon éligible d’une famille encore libre ne correspond'; end if;

  update public.game_rounds set pokemon_id = chosen where id = a.id;
  delete from public.round_clue_rolls where room_id = p_room and round_no = r.round_no;
  insert into public.game_events(room_id, actor_id, event_type, round_no, detail)
  values (p_room, auth.uid(), 'admin_changed_pokemon', r.round_no,
          jsonb_build_object('old_pokemon', old_pokemon, 'new_pokemon', chosen));
  select jsonb_build_object(
    'id', c.pokemon_id, 'national_dex', c.national_dex,
    'display_name', c.display_name, 'form', c.form, 'types', c.types,
    'sprite', c.sprite_url, 'weight_kg', c.weight_kg
  ) into result
  from public.pokemon_catalog c where c.pokemon_id = chosen;
  update public.rooms set updated_at = now() where id = p_room;
  return result;
end
$function$;

grant execute on function public.start_game(uuid) to authenticated;
grant execute on function public.search_spectator_pokemon(uuid, text) to authenticated;
grant execute on function public.admin_change_current_pokemon(uuid, text) to authenticated;
