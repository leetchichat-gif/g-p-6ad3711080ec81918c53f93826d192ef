-- PokeDraft: migrations are the authority for every game rule and balance change.
create extension if not exists pgcrypto with schema extensions;

create type public.room_status as enum ('waiting','active','finished','abandoned');
create type public.auction_mode as enum ('turn_based','blind');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null default 'Dresseur',
  created_at timestamptz not null default now()
);
create function public.new_profile() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin insert into public.profiles(user_id) values(new.id) on conflict do nothing; return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.new_profile();

create table public.pokemon_catalog (
  pokemon_id text primary key,
  national_dex integer not null,
  display_name text not null,
  form text not null default 'standard',
  generation integer not null default 7 check (generation between 1 and 9),
  types text[] not null default '{}',
  sprite_url text not null,
  eligible boolean not null default true,
  scope text not null default 'gen7-introduced'
);
create index pokemon_catalog_eligible on public.pokemon_catalog(eligible, scope);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  created_by uuid not null references auth.users(id),
  status public.room_status not null default 'waiting',
  mode public.auction_mode not null default 'turn_based',
  round_no integer not null default 0 check(round_no between 0 and 12),
  round_total integer not null default 12 check(round_total=12),
  turn_seconds integer not null default 25 check(turn_seconds between 10 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.room_players (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  seat smallint not null check(seat in (1,2)),
  nickname text not null,
  ready boolean not null default false,
  budget integer not null default 10000 check(budget between 0 and 10000),
  joined_at timestamptz not null default now(),
  primary key(room_id,user_id), unique(room_id,seat)
);
create table public.game_rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_no integer not null check(round_no between 1 and 12),
  pokemon_id text not null references public.pokemon_catalog(pokemon_id),
  status text not null default 'pending' check(status in ('pending','active','closed')),
  starter_user_id uuid not null references auth.users(id),
  current_turn_user_id uuid references auth.users(id),
  current_bidder_id uuid references auth.users(id),
  current_price integer not null default 0 check(current_price>=0),
  deadline_at timestamptz,
  winner_id uuid references auth.users(id),
  final_price integer not null default 0 check(final_price>=0),
  closed_at timestamptz,
  unique(room_id,round_no), unique(room_id,pokemon_id)
);
create table public.public_bids (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_no integer not null,
  user_id uuid not null references auth.users(id),
  amount integer not null check(amount>=500),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique(user_id,request_id),
  foreign key(room_id,round_no) references public.game_rounds(room_id,round_no)
);
create table public.secret_bids (
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_no integer not null,
  user_id uuid not null references auth.users(id),
  amount integer not null check(amount=0 or amount>=500),
  submitted_at timestamptz not null default now(),
  primary key(room_id,round_no,user_id),
  foreign key(room_id,round_no) references public.game_rounds(room_id,round_no)
);
create table public.collection (
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_no integer not null,
  owner_id uuid not null references auth.users(id),
  pokemon_id text not null references public.pokemon_catalog(pokemon_id),
  price integer not null check(price>=0),
  created_at timestamptz not null default now(),
  primary key(room_id,pokemon_id), unique(room_id,round_no)
);
create table public.game_events (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  actor_id uuid references auth.users(id),
  event_type text not null,
  round_no integer,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Default scope: all 88 Pokémon introduced in Generation VII. The pool is editable per row.
insert into public.pokemon_catalog(pokemon_id,national_dex,display_name,types,sprite_url) values
('722',722,'Brindibou',array['Plante','Vol'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/722.png'),
('723',723,'Efflèche',array['Plante','Vol'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/723.png'),
('724',724,'Archéduc',array['Plante','Spectre'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/724.png'),
('725',725,'Flamiaou',array['Feu'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/725.png'),
('726',726,'Matoufeu',array['Feu'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/726.png'),
('727',727,'Félinferno',array['Feu','Ténèbres'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/727.png'),
('728',728,'Otaquin',array['Eau'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/728.png'),
('729',729,'Otarlette',array['Eau'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/729.png'),
('730',730,'Oratoria',array['Eau','Fée'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/730.png'),
('731',731,'Picassaut',array['Normal','Vol'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/731.png'),
('732',732,'Piclairon',array['Normal','Vol'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/732.png'),
('733',733,'Bazoucan',array['Normal','Vol'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/733.png'),
('734',734,'Manglouton',array['Normal'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/734.png'),
('735',735,'Argouste',array['Normal'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/735.png'),
('736',736,'Larvibule',array['Insecte'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/736.png'),
('737',737,'Chrysapile',array['Insecte','Électrik'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/737.png'),
('738',738,'Lucanon',array['Insecte','Électrik'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/738.png'),
('739',739,'Crabagarre',array['Combat'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/739.png'),
('740',740,'Crabominable',array['Combat','Glace'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/740.png'),
('741',741,'Plumeline',array['Feu','Vol'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/741.png'),
('742',742,'Bombydou',array['Insecte','Fée'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/742.png'),
('743',743,'Rubombelle',array['Insecte','Fée'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/743.png'),
('744',744,'Rocabot',array['Roche'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/744.png'),
('745',745,'Lougaroc',array['Roche'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/745.png'),
('746',746,'Froussardine',array['Eau'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/746.png'),
('747',747,'Vorastérie',array['Poison','Eau'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/747.png'),
('748',748,'Prédastérie',array['Poison','Eau'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/748.png'),
('749',749,'Tiboudet',array['Sol'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/749.png'),
('750',750,'Bourrinos',array['Sol'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/750.png'),
('751',751,'Araqua',array['Eau','Insecte'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/751.png'),
('752',752,'Tarenbulle',array['Eau','Insecte'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/752.png'),
('753',753,'Mimantis',array['Plante'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/753.png'),
('754',754,'Floramantis',array['Plante'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/754.png'),
('755',755,'Spododo',array['Plante','Fée'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/755.png'),
('756',756,'Lampignon',array['Plante','Fée'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/756.png'),
('757',757,'Tritox',array['Poison','Feu'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/757.png'),
('758',758,'Malamandre',array['Poison','Feu'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/758.png'),
('759',759,'Nounourson',array['Normal','Combat'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/759.png'),
('760',760,'Chelours',array['Normal','Combat'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/760.png'),
('761',761,'Croquine',array['Plante'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/761.png'),
('762',762,'Candine',array['Plante'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/762.png'),
('763',763,'Sucreine',array['Plante'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/763.png'),
('764',764,'Guérilande',array['Fée'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/764.png'),
('765',765,'Gouroutan',array['Normal','Psy'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/765.png'),
('766',766,'Quartermac',array['Combat'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/766.png'),
('767',767,'Sovkipou',array['Insecte','Eau'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/767.png'),
('768',768,'Sarmuraï',array['Insecte','Eau'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/768.png'),
('769',769,'Bacabouh',array['Spectre','Sol'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/769.png'),
('770',770,'Trépassable',array['Spectre','Sol'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/770.png'),
('771',771,'Concombaffe',array['Eau'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/771.png'),
('772',772,'Type:0',array['Normal'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/772.png'),
('773',773,'Silvallié',array['Normal'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/773.png'),
('774',774,'Météno',array['Roche','Vol'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/774.png'),
('775',775,'Dodoala',array['Normal'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/775.png'),
('776',776,'Boumata',array['Feu','Dragon'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/776.png'),
('777',777,'Togedemaru',array['Électrik','Acier'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/777.png'),
('778',778,'Mimiqui',array['Spectre','Fée'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/778.png'),
('779',779,'Denticrisse',array['Eau','Psy'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/779.png'),
('780',780,'Draïeul',array['Normal','Dragon'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/780.png'),
('781',781,'Sinistrail',array['Spectre','Plante'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/781.png'),
('782',782,'Bébécaille',array['Dragon'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/782.png'),
('783',783,'Écaïd',array['Dragon','Combat'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/783.png'),
('784',784,'Ékaïser',array['Dragon','Combat'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/784.png'),
('785',785,'Tokorico',array['Électrik','Fée'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/785.png'),
('786',786,'Tokopiyon',array['Psy','Fée'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/786.png'),
('787',787,'Tokotoro',array['Plante','Fée'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/787.png'),
('788',788,'Tokopisco',array['Eau','Fée'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/788.png'),
('789',789,'Cosmog',array['Psy'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/789.png'),
('790',790,'Cosmovum',array['Psy'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/790.png'),
('791',791,'Solgaleo',array['Psy','Acier'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/791.png'),
('792',792,'Lunala',array['Psy','Spectre'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/792.png'),
('793',793,'Zéroïd',array['Roche','Poison'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/793.png'),
('794',794,'Mouscoto',array['Insecte','Combat'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/794.png'),
('795',795,'Cancrelove',array['Insecte','Combat'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/795.png'),
('796',796,'Câblifère',array['Électrik'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/796.png'),
('797',797,'Bamboiselle',array['Acier','Vol'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/797.png'),
('798',798,'Katagami',array['Plante','Acier'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/798.png'),
('799',799,' అమ? ',array['Ténèbres','Dragon'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/799.png'),
('800',800,'Necrozma',array['Psy'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/800.png'),
('801',801,'Magearna',array['Acier','Fée'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/801.png'),
('802',802,'Marshadow',array['Combat','Spectre'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/802.png'),
('803',803,'Vémini',array['Poison'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/803.png'),
('804',804,'मा? ',array['Poison','Dragon'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/804.png'),
('805',805,'Ama-Ama',array['Roche','Acier'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/805.png'),
('806',806,'طر? ',array['Feu','Spectre'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/806.png'),
('807',807,'Zeraora',array['Électrik'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/807.png'),
('808',808,'Meltan',array['Acier'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/808.png'),
('809',809,'Melmetal',array['Acier'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/809.png')
on conflict(pokemon_id) do update set display_name=excluded.display_name,types=excluded.types,sprite_url=excluded.sprite_url;

alter table public.pokemon_catalog add column if not exists showdown_name text not null default '';

-- Correct a few placeholder translations in the curated seed.
update public.pokemon_catalog set display_name='Bourrinos' where pokemon_id='750';
update public.pokemon_catalog set display_name='Malamandre' where pokemon_id='758';
update public.pokemon_catalog set display_name='Bébécaille' where pokemon_id='782';
update public.pokemon_catalog set display_name='Ékaïser' where pokemon_id='784';
update public.pokemon_catalog set display_name='Ama-Ama' where pokemon_id='805';
update public.pokemon_catalog set display_name='Pierroteknik' where pokemon_id='806';
update public.pokemon_catalog set display_name='Engloutyran' where pokemon_id='799';
update public.pokemon_catalog set display_name='Mandrillon' where pokemon_id='804';

create function public.is_room_member(p_room uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.room_players where room_id=p_room and user_id=auth.uid())
$$;

create function public.create_room(p_nickname text, p_mode public.auction_mode default 'turn_based') returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_code text; v_room public.rooms;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if length(trim(p_nickname)) not between 2 and 20 then raise exception 'Pseudo : 2 à 20 caractères'; end if;
  insert into public.profiles(user_id,nickname) values(auth.uid(),trim(p_nickname)) on conflict(user_id) do update set nickname=excluded.nickname;
  loop v_code := upper(substr(encode(gen_random_bytes(5),'hex'),1,8)); exit when not exists(select 1 from public.rooms where code=v_code); end loop;
  insert into public.rooms(code,created_by,mode) values(v_code,auth.uid(),p_mode) returning * into v_room;
  insert into public.room_players(room_id,user_id,seat,nickname) values(v_room.id,auth.uid(),1,trim(p_nickname));
  insert into public.game_events(room_id,actor_id,event_type) values(v_room.id,auth.uid(),'room_created');
  return jsonb_build_object('id',v_room.id,'code',v_room.code);
end $$;

create function public.join_room(p_code text,p_nickname text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.rooms; n integer; seat_no smallint;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if length(trim(p_nickname)) not between 2 and 20 then raise exception 'Pseudo : 2 à 20 caractères'; end if;
  select * into r from public.rooms where code=upper(trim(p_code)) for update;
  if not found or r.status <> 'waiting' then raise exception 'Salon introuvable ou déjà commencé'; end if;
  if r.created_at < now()-interval '24 hours' then raise exception 'Ce salon a expiré (24 heures)'; end if;
  if exists(select 1 from public.room_players where room_id=r.id and user_id=auth.uid()) then return r.id; end if;
  select count(*) into n from public.room_players where room_id=r.id;
  if n >= 2 then raise exception 'Ce salon est complet'; end if;
  insert into public.profiles(user_id,nickname) values(auth.uid(),trim(p_nickname)) on conflict(user_id) do update set nickname=excluded.nickname;
  if not exists(select 1 from public.room_players where room_id=r.id and seat=1) then seat_no:=1; else seat_no:=2; end if;
  insert into public.room_players(room_id,user_id,seat,nickname) values(r.id,auth.uid(),seat_no,trim(p_nickname));
  insert into public.game_events(room_id,actor_id,event_type) values(r.id,auth.uid(),'player_joined');
  return r.id;
end $$;

create function public.set_ready(p_room uuid,p_ready boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_status public.room_status;
begin
  if not public.is_room_member(p_room) then raise exception 'Accès refusé'; end if;
  select status into v_status from public.rooms where id=p_room for update;
  if v_status<>'waiting' then raise exception 'La salle d’attente est terminée'; end if;
  update public.room_players set ready=p_ready where room_id=p_room and user_id=auth.uid();
  update public.rooms set updated_at=now() where id=p_room and status='waiting';
end $$;

create function public.start_game(p_room uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.rooms; p record; starters uuid[]; i integer:=0; chosen uuid[];
begin
  select * into r from public.rooms where id=p_room for update;
  if not public.is_room_member(p_room) then raise exception 'Accès refusé'; end if;
  if r.status <> 'waiting' then raise exception 'Partie déjà démarrée'; end if;
  if r.created_at < now()-interval '24 hours' then raise exception 'Ce salon a expiré (24 heures)'; end if;
  if (select count(*) from public.room_players where room_id=p_room)<>2 or exists(select 1 from public.room_players where room_id=p_room and not ready) then raise exception 'Deux joueurs prêts sont nécessaires'; end if;
  if (select count(*) from public.pokemon_catalog where eligible and scope in ('gen7-introduced','alola-forms')) < 12 then raise exception 'Le catalogue éligible doit contenir au moins 12 Pokémon'; end if;
  select array_agg(user_id order by seat) into starters from public.room_players where room_id=p_room;
  for p in select pokemon_id from public.pokemon_catalog where eligible and scope in ('gen7-introduced','alola-forms') order by random() limit 12 loop
    i:=i+1;
    insert into public.game_rounds(room_id,round_no,pokemon_id,status,starter_user_id,current_turn_user_id,deadline_at)
      values(p_room,i,p.pokemon_id,case when i=1 then 'active' else 'pending' end,starters[case when i%2=1 then 1 else 2 end],case when i=1 then starters[1] else null end,case when i=1 then now()+make_interval(secs=>r.turn_seconds) else null end);
  end loop;
  update public.rooms set status='active',round_no=1,updated_at=now() where id=p_room;
  insert into public.game_events(room_id,actor_id,event_type,round_no) values(p_room,auth.uid(),'game_started',1);
end $$;

create function public._advance_lot(p_room uuid,p_round integer,p_winner uuid,p_price integer) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.rooms; nxt public.game_rounds;
begin
  select * into r from public.rooms where id=p_room for update;
  if exists(select 1 from public.game_rounds where room_id=p_room and round_no=p_round and status='closed') then return; end if;
  update public.game_rounds set status='closed',winner_id=p_winner,final_price=p_price,closed_at=now(),deadline_at=null where room_id=p_room and round_no=p_round and status='active';
  if p_winner is not null then
    update public.room_players set budget=budget-p_price where room_id=p_room and user_id=p_winner and budget>=p_price;
    if not found then raise exception 'Budget insuffisant au règlement'; end if;
    insert into public.collection(room_id,round_no,owner_id,pokemon_id,price)
      select room_id,round_no,p_winner,pokemon_id,p_price from public.game_rounds where room_id=p_room and round_no=p_round;
  end if;
  insert into public.game_events(room_id,actor_id,event_type,round_no,detail) values(p_room,auth.uid(),'lot_closed',p_round,jsonb_build_object('winner',p_winner,'price',p_price));
  if p_round >= 12 then update public.rooms set status='finished',round_no=12,updated_at=now() where id=p_room; return; end if;
  select * into nxt from public.game_rounds where room_id=p_room and round_no=p_round+1 for update;
  update public.game_rounds set status='active',current_turn_user_id=starter_user_id,deadline_at=now()+make_interval(secs=>r.turn_seconds) where id=nxt.id;
  update public.rooms set round_no=p_round+1,updated_at=now() where id=p_room;
end $$;

create function public.place_bid(p_room uuid,p_amount integer,p_request uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.rooms; a public.game_rounds; me public.room_players; opponent uuid; v_min integer;
begin
  if exists(select 1 from public.public_bids where user_id=auth.uid() and request_id=p_request) then return; end if;
  select * into r from public.rooms where id=p_room for update;
  if not public.is_room_member(p_room) then raise exception 'Accès refusé'; end if;
  if r.status<>'active' or r.mode<>'turn_based' then raise exception 'Enchère indisponible'; end if;
  select * into a from public.game_rounds where room_id=p_room and round_no=r.round_no for update;
  select * into me from public.room_players where room_id=p_room and user_id=auth.uid() for update;
  if a.status<>'active' or now()>a.deadline_at then raise exception 'Délai expiré'; end if;
  if a.current_turn_user_id<>auth.uid() then raise exception 'Ce n’est pas votre tour'; end if;
  v_min := case when a.current_price=0 then 500 else a.current_price+100 end;
  if p_amount < v_min then raise exception 'La surenchère minimale est % P$',v_min; end if;
  if p_amount>me.budget then raise exception 'Budget insuffisant'; end if;
  select user_id into opponent from public.room_players where room_id=p_room and user_id<>auth.uid();
  insert into public.public_bids(room_id,round_no,user_id,amount,request_id) values(p_room,r.round_no,auth.uid(),p_amount,p_request);
  update public.game_rounds set current_price=p_amount,current_bidder_id=auth.uid(),current_turn_user_id=opponent,deadline_at=now()+make_interval(secs=>r.turn_seconds) where id=a.id;
  update public.rooms set updated_at=now() where id=p_room;
end $$;

create function public._resolve_blind(p_room uuid,p_round integer) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.rooms; a public.game_rounds; b1 public.secret_bids; b2 public.secret_bids; u1 uuid; u2 uuid; win uuid; price integer:=0;
begin
  select * into r from public.rooms where id=p_room for update;
  select * into a from public.game_rounds where room_id=p_room and round_no=p_round for update;
  if a.status<>'active' then return; end if;
  select user_id into u1 from public.room_players where room_id=p_room order by seat limit 1;
  select user_id into u2 from public.room_players where room_id=p_room order by seat desc limit 1;
  select * into b1 from public.secret_bids where room_id=p_room and round_no=p_round and user_id=u1;
  select * into b2 from public.secret_bids where room_id=p_room and round_no=p_round and user_id=u2;
  if b1.user_id is null and b2.user_id is null then win:=null;
  elsif b1.user_id is null then win:=u2; price:=b2.amount;
  elsif b2.user_id is null then win:=u1; price:=b1.amount;
  elsif b1.amount>b2.amount then win:=u1; price:=b1.amount;
  elsif b2.amount>b1.amount then win:=u2; price:=b2.amount;
  elsif b1.amount=0 then win:=null; price:=0;
  else win:=a.starter_user_id; price:=b1.amount; end if;
  perform public._advance_lot(p_room,p_round,win,price);
end $$;

create function public.submit_secret_bid(p_room uuid,p_amount integer) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.rooms; a public.game_rounds; me public.room_players;
begin
  select * into r from public.rooms where id=p_room for update;
  if not public.is_room_member(p_room) then raise exception 'Accès refusé'; end if;
  if r.status<>'active' or r.mode<>'blind' then raise exception 'Enchère indisponible'; end if;
  select * into a from public.game_rounds where room_id=p_room and round_no=r.round_no for update;
  select * into me from public.room_players where room_id=p_room and user_id=auth.uid() for update;
  if a.status<>'active' or now()>a.deadline_at then raise exception 'Délai expiré'; end if;
  if p_amount<>0 and p_amount<500 then raise exception 'La mise minimale est 500 P$'; end if;
  if p_amount>me.budget then raise exception 'Budget insuffisant'; end if;
  insert into public.secret_bids(room_id,round_no,user_id,amount) values(p_room,r.round_no,auth.uid(),p_amount) on conflict(room_id,round_no,user_id) do nothing;
  if (select count(*) from public.secret_bids where room_id=p_room and round_no=r.round_no)=2 then perform public._resolve_blind(p_room,r.round_no); end if;
end $$;

create function public.pass_auction(p_room uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.rooms; a public.game_rounds;
begin
  select * into r from public.rooms where id=p_room for update;
  if not public.is_room_member(p_room) then raise exception 'Accès refusé'; end if;
  if r.mode<>'turn_based' or r.status<>'active' then raise exception 'Action indisponible'; end if;
  select * into a from public.game_rounds where room_id=p_room and round_no=r.round_no for update;
  if a.current_turn_user_id<>auth.uid() then raise exception 'Ce n’est pas votre tour'; end if;
  if a.deadline_at is null or now()>a.deadline_at then raise exception 'Délai expiré'; end if;
  perform public._advance_lot(p_room,r.round_no,a.current_bidder_id,a.current_price);
end $$;

create function public.tick_auction(p_room uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.rooms; a public.game_rounds;
begin
  if not public.is_room_member(p_room) then raise exception 'Accès refusé'; end if;
  select * into r from public.rooms where id=p_room for update;
  if r.status<>'active' then return; end if;
  select * into a from public.game_rounds where room_id=p_room and round_no=r.round_no for update;
  if a.deadline_at>now() then return; end if;
  if r.mode='blind' then perform public._resolve_blind(p_room,r.round_no);
  else perform public._advance_lot(p_room,r.round_no,a.current_bidder_id,a.current_price); end if;
end $$;

create function public.get_room_state(p_room uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r public.rooms; a public.game_rounds; me uuid:=auth.uid();
begin
  if not public.is_room_member(p_room) then raise exception 'Accès refusé'; end if;
  select * into r from public.rooms where id=p_room;
  select * into a from public.game_rounds where room_id=p_room and round_no=r.round_no;
  return jsonb_build_object(
    'user_id',me,
    'room',jsonb_build_object('id',r.id,'code',r.code,'status',r.status,'mode',r.mode,'round_no',r.round_no,'round_total',r.round_total,
      'deadline_at',a.deadline_at,'current_turn_user_id',a.current_turn_user_id,'current_price',a.current_price,
      'current_pokemon',(select jsonb_build_object('id',c.pokemon_id,'national_dex',c.national_dex,'name',c.display_name,'display_name',c.display_name,'showdown_name',c.showdown_name,'form',c.form,'types',c.types,'sprite',c.sprite_url) from public.pokemon_catalog c where c.pokemon_id=a.pokemon_id),
      'starter_user_id',a.starter_user_id,
      'result',case when a.status='closed' then jsonb_build_object('winner_id',a.winner_id,'price',a.final_price) else null end),
    'players',(select coalesce(jsonb_agg(jsonb_build_object('user_id',p.user_id,'nickname',p.nickname,'ready',p.ready,'online',true,'seat',p.seat,'budget',p.budget) order by p.seat),'[]'::jsonb) from public.room_players p where p.room_id=p_room),
    'bids',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'user_id',b.user_id,'nickname',p.nickname,'amount',b.amount,'created_at',b.created_at) order by b.created_at),'[]'::jsonb) from public.public_bids b join public.room_players p using(room_id,user_id) where b.room_id=p_room),
    'collection',(select coalesce(jsonb_agg(jsonb_build_object('pokemon',jsonb_build_object('id',c.pokemon_id,'national_dex',d.national_dex,'name',d.display_name,'display_name',d.display_name,'showdown_name',d.showdown_name,'form',d.form,'types',d.types,'sprite',d.sprite_url),'owner_id',c.owner_id,'owner_name',p.nickname,'price',c.price) order by c.round_no),'[]'::jsonb) from public.collection c join public.pokemon_catalog d on d.pokemon_id=c.pokemon_id join public.room_players p on p.room_id=c.room_id and p.user_id=c.owner_id where c.room_id=p_room)
  );
end $$;

create function public.leave_room(p_room uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.rooms;
begin
  if not public.is_room_member(p_room) then return; end if;
  select * into r from public.rooms where id=p_room for update;
  if r.status='waiting' then delete from public.room_players where room_id=p_room and user_id=auth.uid();
  elsif r.status='active' then update public.rooms set status='abandoned',updated_at=now() where id=p_room; end if;
  insert into public.game_events(room_id,actor_id,event_type) values(p_room,auth.uid(),'player_left');
end $$;

alter table public.profiles enable row level security;
alter table public.pokemon_catalog enable row level security;
alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.game_rounds enable row level security;
alter table public.public_bids enable row level security;
alter table public.secret_bids enable row level security;
alter table public.collection enable row level security;
alter table public.game_events enable row level security;

create policy "profile self read" on public.profiles for select to authenticated using(user_id=auth.uid());
create policy "catalog readable" on public.pokemon_catalog for select to authenticated using(true);
create policy "rooms members read" on public.rooms for select to authenticated using(public.is_room_member(id));
create policy "members list players" on public.room_players for select to authenticated using(public.is_room_member(room_id));
create policy "members read public bids" on public.public_bids for select to authenticated using(public.is_room_member(room_id));
create policy "private bid owner read" on public.secret_bids for select to authenticated using(user_id=auth.uid() and public.is_room_member(room_id));
create policy "members read collection" on public.collection for select to authenticated using(public.is_room_member(room_id));
create policy "members read events" on public.game_events for select to authenticated using(public.is_room_member(room_id));
-- No direct client writes; every state transition goes through the checks above.
revoke all on public.rooms,public.room_players,public.game_rounds,public.public_bids,public.secret_bids,public.collection,public.game_events,public.profiles from anon,authenticated;
grant select on public.rooms,public.room_players,public.public_bids,public.secret_bids,public.collection,public.game_events,public.pokemon_catalog,public.profiles to authenticated;
revoke all on function public.is_room_member(uuid) from public;
grant execute on function public.is_room_member(uuid) to authenticated;
revoke all on function public.create_room(text,public.auction_mode),public.join_room(text,text),public.set_ready(uuid,boolean),public.start_game(uuid),public.place_bid(uuid,integer,uuid),public.submit_secret_bid(uuid,integer),public.pass_auction(uuid),public.tick_auction(uuid),public.get_room_state(uuid),public.leave_room(uuid) from public;
grant execute on function public.create_room(text,public.auction_mode),public.join_room(text,text),public.set_ready(uuid,boolean),public.start_game(uuid),public.place_bid(uuid,integer,uuid),public.submit_secret_bid(uuid,integer),public.pass_auction(uuid),public.tick_auction(uuid),public.get_room_state(uuid),public.leave_room(uuid) to authenticated;

do $$ begin alter publication supabase_realtime add table public.rooms; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.public_bids; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.room_players; exception when duplicate_object then null; end $$;

-- Private Realtime Presence is scoped to members of the UUID room topic.
create policy "room members read presence"
on realtime.messages for select to authenticated
using (extension='presence' and case
  when realtime.topic() ~ '^room:[0-9a-fA-F-]{36}$'
  then public.is_room_member(split_part(realtime.topic(),':',2)::uuid)
  else false end);
create policy "room members publish presence"
on realtime.messages for insert to authenticated
with check (extension='presence' and case
  when realtime.topic() ~ '^room:[0-9a-fA-F-]{36}$'
  then public.is_room_member(split_part(realtime.topic(),':',2)::uuid)
  else false end);

-- Publicly safe result history. Secret amounts are never returned here.
create or replace function public.get_room_results(p_room uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.is_room_member(p_room) then raise exception 'Accès refusé'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'round_no',g.round_no,'pokemon',jsonb_build_object('id',c.pokemon_id,'national_dex',c.national_dex,'display_name',c.display_name,'types',c.types,'sprite',c.sprite_url),
    'winner_id',g.winner_id,'winner_name',p.nickname,'price',g.final_price
  ) order by g.round_no),'[]'::jsonb)
  from public.game_rounds g join public.pokemon_catalog c on c.pokemon_id=g.pokemon_id
  left join public.room_players p on p.room_id=g.room_id and p.user_id=g.winner_id
  where g.room_id=p_room and g.status='closed');
end $$;
revoke all on function public.get_room_results(uuid) from public;
grant execute on function public.get_room_results(uuid) to authenticated;

-- Species translations and records for forms that are distinct in Generation VII formats.
update public.pokemon_catalog set display_name=case pokemon_id
  when '799' then 'Engloutyran' when '804' then 'Mandrillon' when '806' then 'Pierroteknik' else display_name end
  where pokemon_id in ('799','804','806');
update public.pokemon_catalog set display_name='Denticrisse' where pokemon_id='779';
insert into public.pokemon_catalog(pokemon_id,national_dex,display_name,form,generation,types,sprite_url,scope) values
('19-alola',19,'Rattata d’Alola','Alola',7,array['Ténèbres','Normal'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/10091.png','alola-forms'),
('20-alola',20,'Rattatac d’Alola','Alola',7,array['Ténèbres','Normal'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/10092.png','alola-forms'),
('26-alola',26,'Raichu d’Alola','Alola',7,array['Électrik','Psy'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/10100.png','alola-forms'),
('27-alola',27,'Sabelette d’Alola','Alola',7,array['Glace','Acier'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/10101.png','alola-forms'),
('28-alola',28,'Sablaireau d’Alola','Alola',7,array['Glace','Acier'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/10102.png','alola-forms'),
('37-alola',37,'Goupix d’Alola','Alola',7,array['Glace'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/10103.png','alola-forms'),
('38-alola',38,'Feunard d’Alola','Alola',7,array['Glace','Fée'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/10104.png','alola-forms'),
('50-alola',50,'Taupiqueur d’Alola','Alola',7,array['Sol','Acier'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/10105.png','alola-forms'),
('51-alola',51,'Triopikeur d’Alola','Alola',7,array['Sol','Acier'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/10106.png','alola-forms'),
('52-alola',52,'Miaouss d’Alola','Alola',7,array['Ténèbres'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/10107.png','alola-forms'),
('53-alola',53,'Persian d’Alola','Alola',7,array['Ténèbres'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/10108.png','alola-forms'),
('74-alola',74,'Racaillou d’Alola','Alola',7,array['Roche','Électrik'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/10109.png','alola-forms'),
('75-alola',75,'Gravalanch d’Alola','Alola',7,array['Roche','Électrik'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/10110.png','alola-forms'),
('76-alola',76,'Grolem d’Alola','Alola',7,array['Roche','Électrik'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/10111.png','alola-forms'),
('88-alola',88,'Tadmorv d’Alola','Alola',7,array['Poison','Ténèbres'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/10112.png','alola-forms'),
('89-alola',89,'Grotadmorv d’Alola','Alola',7,array['Poison','Ténèbres'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/10113.png','alola-forms'),
('103-alola',103,'Noadkoko d’Alola','Alola',7,array['Plante','Dragon'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/10114.png','alola-forms'),
('105-alola',105,'Ossatueur d’Alola','Alola',7,array['Feu','Spectre'],'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/10115.png','alola-forms')
on conflict(pokemon_id) do nothing;

-- Showdown parses English species names even though the interface is localized in French.
alter table public.pokemon_catalog add column if not exists showdown_name text not null default '';
update public.pokemon_catalog set showdown_name=case pokemon_id
  when '722' then 'Rowlet' when '723' then 'Dartrix' when '724' then 'Decidueye'
  when '725' then 'Litten' when '726' then 'Torracat' when '727' then 'Incineroar'
  when '728' then 'Popplio' when '729' then 'Brionne' when '730' then 'Primarina'
  when '731' then 'Pikipek' when '732' then 'Trumbeak' when '733' then 'Toucannon'
  when '734' then 'Yungoos' when '735' then 'Gumshoos' when '736' then 'Grubbin'
  when '737' then 'Charjabug' when '738' then 'Vikavolt' when '739' then 'Crabrawler'
  when '740' then 'Crabominable' when '741' then 'Oricorio' when '742' then 'Cutiefly'
  when '743' then 'Ribombee' when '744' then 'Rockruff' when '745' then 'Lycanroc'
  when '746' then 'Wishiwashi' when '747' then 'Mareanie' when '748' then 'Toxapex'
  when '749' then 'Mudbray' when '750' then 'Mudsdale' when '751' then 'Dewpider'
  when '752' then 'Araquanid' when '753' then 'Fomantis' when '754' then 'Lurantis'
  when '755' then 'Morelull' when '756' then 'Shiinotic' when '757' then 'Salandit'
  when '758' then 'Salazzle' when '759' then 'Stufful' when '760' then 'Bewear'
  when '761' then 'Bounsweet' when '762' then 'Steenee' when '763' then 'Tsareena'
  when '764' then 'Comfey' when '765' then 'Oranguru' when '766' then 'Passimian'
  when '767' then 'Wimpod' when '768' then 'Golisopod' when '769' then 'Sandygast'
  when '770' then 'Palossand' when '771' then 'Pyukumuku' when '772' then 'Type: Null'
  when '773' then 'Silvally' when '774' then 'Minior' when '775' then 'Komala'
  when '776' then 'Turtonator' when '777' then 'Togedemaru' when '778' then 'Mimikyu'
  when '779' then 'Bruxish' when '780' then 'Drampa' when '781' then 'Dhelmise'
  when '782' then 'Jangmo-o' when '783' then 'Hakamo-o' when '784' then 'Kommo-o'
  when '785' then 'Tapu Koko' when '786' then 'Tapu Lele' when '787' then 'Tapu Bulu'
  when '788' then 'Tapu Fini' when '789' then 'Cosmog' when '790' then 'Cosmoem'
  when '791' then 'Solgaleo' when '792' then 'Lunala' when '793' then 'Nihilego'
  when '794' then 'Buzzwole' when '795' then 'Pheromosa' when '796' then 'Xurkitree'
  when '797' then 'Celesteela' when '798' then 'Kartana' when '799' then 'Guzzlord'
  when '800' then 'Necrozma' when '801' then 'Magearna' when '802' then 'Marshadow'
  when '803' then 'Poipole' when '804' then 'Naganadel' when '805' then 'Stakataka'
  when '806' then 'Blacephalon' when '807' then 'Zeraora' when '808' then 'Meltan' when '809' then 'Melmetal'
  when '19-alola' then 'Rattata-Alola' when '20-alola' then 'Raticate-Alola' when '26-alola' then 'Raichu-Alola'
  when '27-alola' then 'Sandshrew-Alola' when '28-alola' then 'Sandslash-Alola' when '37-alola' then 'Vulpix-Alola'
  when '38-alola' then 'Ninetales-Alola' when '50-alola' then 'Diglett-Alola' when '51-alola' then 'Dugtrio-Alola'
  when '52-alola' then 'Meowth-Alola' when '53-alola' then 'Persian-Alola' when '74-alola' then 'Geodude-Alola'
  when '75-alola' then 'Graveler-Alola' when '76-alola' then 'Golem-Alola' when '88-alola' then 'Grimer-Alola'
  when '89-alola' then 'Muk-Alola' when '103-alola' then 'Exeggutor-Alola' when '105-alola' then 'Marowak-Alola'
  else coalesce(nullif(showdown_name,''),display_name) end;
