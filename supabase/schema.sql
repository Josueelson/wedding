-- =====================================================================
--  Invitation de mariage — schéma Supabase
--  À exécuter UNE fois dans : Supabase > SQL Editor > New query > Run
--  Rejouable sans danger (create if not exists / create or replace).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

-- Un événement = un mariage. Il appartient au compte des mariés (owner_id).
create table if not exists public.events (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references auth.users(id) on delete cascade,

  groom_name         text not null default 'Philippe',
  bride_name         text not null default 'Jeanine',

  -- Mariage civil
  civil_date         date,
  civil_time         text,
  civil_place        text,
  -- Bénédiction nuptiale (cérémonie principale : sa date est affichée en tête)
  religious_date     date,
  religious_time     text,
  religious_place    text,
  -- Réception
  reception_date     date,
  reception_time     text,
  reception_place    text,
  reception_address  text,

  map_url            text,          -- lien Google Maps complet (facultatif)
  rsvp_deadline      date,          -- date limite de réponse
  welcome_text       text,          -- phrase d'accueil
  info_text          text,          -- tenue, informations pratiques…
  closing_text       text,          -- mot de fin
  share_message      text,          -- modèle du message WhatsApp ({nom}, {lien}, {mariés})
  max_drinks         int  not null default 2 check (max_drinks between 0 and 10),

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Un seul événement par compte (le back-office gère "votre" mariage).
create unique index if not exists events_owner_unique on public.events(owner_id);

-- Catalogue des boissons proposées aux invités.
create table if not exists public.drinks (
  id        bigint generated always as identity primary key,
  event_id  uuid not null references public.events(id) on delete cascade,
  name      text not null,
  kind      text not null default 'soft' check (kind in ('alcohol', 'soft')),
  sort      int  not null default 0,
  active    boolean not null default true
);
create index if not exists drinks_event_idx on public.drinks(event_id);

-- Une invitation = un invité (ou un couple / une famille) + sa réponse.
create table if not exists public.invitations (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references public.events(id) on delete cascade,

  -- Jeton secret du lien personnel : /?i=<token>
  token               text not null unique
                      default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),

  -- Qui est invité
  title               text,                  -- Mr, Mme, Famille…
  full_name           text not null,
  phone               text,
  email               text,
  category            text,                  -- Famille, Amis, Collègues…
  side                text check (side in ('groom', 'bride', 'both')),

  -- Placement
  table_name          text,
  seats               int not null default 1 check (seats between 1 and 50),

  -- À quelles cérémonies il est convié
  invited_civil       boolean not null default true,
  invited_religious   boolean not null default true,
  invited_reception   boolean not null default true,

  personal_message    text,                  -- mot personnel affiché sur SON invitation
  notes               text,                  -- notes privées (jamais visibles de l'invité)

  -- Réponse de l'invité
  status              text not null default 'pending'
                      check (status in ('pending', 'confirmed', 'declined')),
  people_count        int  not null default 0 check (people_count >= 0),
  drink_ids           bigint[] not null default '{}',
  message             text,                  -- livre d'or
  message_at          timestamptz,
  responded_at        timestamptz,

  -- Suivi
  shared_at           timestamptz,           -- quand le lien a été partagé
  first_opened_at     timestamptz,
  last_opened_at      timestamptz,
  open_count          int not null default 0,

  created_at          timestamptz not null default now()
);
create index if not exists invitations_event_idx on public.invitations(event_id);

-- ---------------------------------------------------------------------
-- 2. TRIGGERS
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

-- À la création d'un événement : boissons par défaut.
create or replace function public.seed_default_drinks() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.drinks (event_id, name, kind, sort) values
    (new.id, 'Beaufort',      'alcohol', 10),
    (new.id, 'Simba',         'alcohol', 20),
    (new.id, 'Chui',          'alcohol', 30),
    (new.id, 'Castel',        'alcohol', 40),
    (new.id, 'Jino',          'soft',    50),
    (new.id, 'Jus de fruits', 'soft',    60);
  return new;
end $$;

drop trigger if exists events_seed_drinks on public.events;
create trigger events_seed_drinks after insert on public.events
  for each row execute function public.seed_default_drinks();

-- ---------------------------------------------------------------------
-- 3. SÉCURITÉ (RLS) : seuls les mariés lisent/écrivent les tables
--    Les invités (anonymes) passent EXCLUSIVEMENT par les 2 fonctions
--    ci-dessous, avec leur jeton secret.
-- ---------------------------------------------------------------------

alter table public.events      enable row level security;
alter table public.drinks      enable row level security;
alter table public.invitations enable row level security;

revoke all on public.events, public.drinks, public.invitations from anon;

drop policy if exists events_owner on public.events;
create policy events_owner on public.events
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists drinks_owner on public.drinks;
create policy drinks_owner on public.drinks
  for all to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and e.owner_id = auth.uid()))
  with check (exists (select 1 from public.events e where e.id = event_id and e.owner_id = auth.uid()));

drop policy if exists invitations_owner on public.invitations;
create policy invitations_owner on public.invitations
  for all to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and e.owner_id = auth.uid()))
  with check (exists (select 1 from public.events e where e.id = event_id and e.owner_id = auth.uid()));

-- ---------------------------------------------------------------------
-- 4. FONCTIONS PUBLIQUES (appelées par la page d'invitation)
-- ---------------------------------------------------------------------

-- Retourne l'invitation, l'événement et les boissons — sans aucune donnée privée.
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
      'table_name', inv.table_name, 'seats', inv.seats,
      'invited_civil', inv.invited_civil,
      'invited_religious', inv.invited_religious,
      'invited_reception', inv.invited_reception,
      'personal_message', inv.personal_message,
      'status', inv.status, 'people_count', inv.people_count,
      'drink_ids', to_jsonb(inv.drink_ids),
      'message', inv.message, 'responded_at', inv.responded_at
    ),
    'event', jsonb_build_object(
      'groom_name', ev.groom_name, 'bride_name', ev.bride_name,
      'civil_date', ev.civil_date, 'civil_time', ev.civil_time, 'civil_place', ev.civil_place,
      'religious_date', ev.religious_date, 'religious_time', ev.religious_time, 'religious_place', ev.religious_place,
      'reception_date', ev.reception_date, 'reception_time', ev.reception_time,
      'reception_place', ev.reception_place, 'reception_address', ev.reception_address,
      'map_url', ev.map_url, 'rsvp_deadline', ev.rsvp_deadline,
      'welcome_text', ev.welcome_text, 'info_text', ev.info_text, 'closing_text', ev.closing_text,
      'max_drinks', ev.max_drinks
    ),
    'drinks', (
      select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'kind', d.kind)
                                order by d.sort, d.id), '[]'::jsonb)
        from public.drinks d
       where d.event_id = ev.id and d.active
    )
  );
end $$;

-- Enregistre (ou modifie) la réponse d'un invité. Toutes les valeurs sont revalidées côté serveur.
create or replace function public.submit_rsvp(
  p_token   text,
  p_status  text,
  p_people  int,
  p_drinks  bigint[],
  p_message text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  inv      public.invitations;
  ev       public.events;
  v_people int;
  v_drinks bigint[];
  v_msg    text;
begin
  select * into inv from public.invitations where token = p_token;
  if not found then
    raise exception 'invitation_not_found' using errcode = 'P0001';
  end if;
  select * into ev from public.events where id = inv.event_id;

  if p_status not in ('confirmed', 'declined') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;

  if p_status = 'confirmed' then
    v_people := least(greatest(coalesce(p_people, 1), 1), inv.seats);
    select coalesce(array_agg(d.id order by d.sort, d.id), '{}') into v_drinks
      from public.drinks d
     where d.id = any(coalesce(p_drinks, '{}')) and d.event_id = inv.event_id and d.active;
    if cardinality(v_drinks) > ev.max_drinks then
      raise exception 'too_many_drinks' using errcode = 'P0001';
    end if;
  else
    v_people := 0;
    v_drinks := '{}';
  end if;

  v_msg := nullif(left(btrim(coalesce(p_message, '')), 1000), '');

  update public.invitations set
    status       = p_status,
    people_count = v_people,
    drink_ids    = v_drinks,
    message_at   = case when v_msg is null then null
                        when v_msg is distinct from message then now()
                        else message_at end,
    message      = v_msg,
    responded_at = now()
  where id = inv.id;

  return jsonb_build_object(
    'status', p_status, 'people_count', v_people,
    'drink_ids', to_jsonb(v_drinks), 'message', v_msg, 'responded_at', now()
  );
end $$;

revoke all on function public.get_invitation(text)                              from public;
revoke all on function public.submit_rsvp(text, text, int, bigint[], text)      from public;
grant execute on function public.get_invitation(text)                           to anon, authenticated;
grant execute on function public.submit_rsvp(text, text, int, bigint[], text)   to anon, authenticated;
