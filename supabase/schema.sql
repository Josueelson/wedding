-- =====================================================================
--  Mariage Coutumier — Elvis Lusima & Celia Petemoya
--  Schéma simplifié : invitation coutumière uniquement
--  (sans boissons, livre d'or, tables, cérémonie religieuse, réception)
--  À exécuter dans : Supabase > SQL Editor > New query > Run
--  Rejouable sans danger (create if not exists / create or replace).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

-- Un événement = un mariage coutumier. Il appartient au compte des mariés (owner_id).
create table if not exists public.events (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,

  groom_name    text not null default 'Elvis',
  bride_name    text not null default 'Celia',

  -- Cérémonie
  civil_date    date,
  civil_time    text default '16h00',
  civil_place   text,

  map_url       text,         -- lien Google Maps (facultatif)
  rsvp_deadline date,         -- date limite de réponse

  welcome_text  text,         -- phrase d'accueil de l'invitation
  info_text     text,         -- informations pratiques (tenue, horaire…)
  closing_text  text,         -- mot de fin
  share_message text,         -- modèle du message WhatsApp ({nom}, {lien}, {mariés})

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Un seul événement par compte.
create unique index if not exists events_owner_unique on public.events(owner_id);

-- Une invitation = un invité (ou un couple / une famille) + sa réponse.
create table if not exists public.invitations (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.events(id) on delete cascade,

  -- Jeton secret du lien personnel : /?i=<token>
  token            text not null unique
                   default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),

  -- Qui est invité
  title            text,                  -- Couple, Mr, Mme…
  full_name        text not null,
  phone            text,
  email            text,
  category         text,                  -- Famille, Amis…
  side             text check (side in ('groom', 'bride', 'both')),

  -- Nombre de places réservées
  seats            int not null default 1 check (seats between 1 and 50),

  personal_message text,                  -- mot personnel affiché sur l'invitation
  notes            text,                  -- notes privées (jamais visibles de l'invité)

  -- Réponse de l'invité
  status           text not null default 'pending'
                   check (status in ('pending', 'confirmed', 'declined')),
  people_count     int  not null default 0 check (people_count >= 0),
  responded_at     timestamptz,

  -- Suivi envoi
  shared_at        timestamptz,
  first_opened_at  timestamptz,
  last_opened_at   timestamptz,
  open_count       int not null default 0,

  created_at       timestamptz not null default now()
);
create index if not exists invitations_event_idx on public.invitations(event_id);

-- ---------------------------------------------------------------------
-- 2. TRIGGER updated_at
-- ---------------------------------------------------------------------

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists events_touch on public.events;
create trigger events_touch before update on public.events
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 3. PERMISSIONS & SÉCURITÉ (RLS)
-- ---------------------------------------------------------------------

-- Accorder l'usage du schéma public aux rôles API
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on routines to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;

alter table public.events      enable row level security;
alter table public.invitations enable row level security;

-- Seul le propriétaire authentifié peut lire et modifier directement les tables
drop policy if exists events_owner on public.events;
create policy events_owner on public.events
  for all to authenticated
  using (owner_id = auth.uid() or owner_id is null)
  with check (owner_id = auth.uid() or owner_id is null);

drop policy if exists invitations_owner on public.invitations;
create policy invitations_owner on public.invitations
  for all to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and (e.owner_id = auth.uid() or e.owner_id is null)))
  with check (exists (select 1 from public.events e where e.id = event_id and (e.owner_id = auth.uid() or e.owner_id is null)));

-- ---------------------------------------------------------------------
-- 4. FONCTIONS PUBLIQUES (appelées par la page d'invitation)
-- ---------------------------------------------------------------------

-- Retourne l'invitation et l'événement — sans aucune donnée privée.
create or replace function public.get_invitation(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  inv public.invitations;
  ev  public.events;
begin
  select * into inv from public.invitations where token = p_token;
  if not found then
    return null;
  end if;
  select * into ev from public.events where id = inv.event_id;

  update public.invitations
     set open_count      = open_count + 1,
         last_opened_at  = now(),
         first_opened_at = coalesce(first_opened_at, now())
   where id = inv.id;

  return jsonb_build_object(
    'invitation', jsonb_build_object(
      'title', inv.title, 'full_name', inv.full_name,
      'seats', inv.seats,
      'personal_message', inv.personal_message,
      'status', inv.status, 'people_count', inv.people_count,
      'responded_at', inv.responded_at
    ),
    'event', jsonb_build_object(
      'groom_name', ev.groom_name, 'bride_name', ev.bride_name,
      'civil_date', ev.civil_date, 'civil_time', ev.civil_time, 'civil_place', ev.civil_place,
      'map_url', ev.map_url, 'rsvp_deadline', ev.rsvp_deadline,
      'welcome_text', ev.welcome_text, 'info_text', ev.info_text, 'closing_text', ev.closing_text
    )
  );
end $$;

-- Enregistre la réponse d'un invité.
create or replace function public.submit_rsvp(
  p_token   text,
  p_status  text,
  p_people  int,
  p_message text  -- conservé pour compatibilité future, non utilisé
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  inv      public.invitations;
  v_people int;
begin
  select * into inv from public.invitations where token = p_token;
  if not found then
    raise exception 'invitation_not_found' using errcode = 'P0001';
  end if;

  if p_status not in ('confirmed', 'declined') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;

  if p_status = 'confirmed' then
    v_people := least(greatest(coalesce(p_people, 1), 1), inv.seats);
  else
    v_people := 0;
  end if;

  update public.invitations set
    status       = p_status,
    people_count = v_people,
    responded_at = now()
  where id = inv.id;

  return jsonb_build_object(
    'status', p_status, 'people_count', v_people, 'responded_at', now()
  );
end $$;

revoke all on function public.get_invitation(text)                        from public;
revoke all on function public.submit_rsvp(text, text, int, text)          from public;
grant execute on function public.get_invitation(text)                     to anon, authenticated;
grant execute on function public.submit_rsvp(text, text, int, text)       to anon, authenticated;
