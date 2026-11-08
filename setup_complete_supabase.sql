-- =====================================================================
--  INSTALLATION / MIGRATION COMPLÈTE — SUPABASE
--  Mariage Civil : Elvis Lusima & Celia Petemoya
--  Date : 06/12/2026
--  Lieu : Golf Faustin, Deuxième marché, Avenue Kabongo
--
--  À exécuter en UNE SEULE FOIS dans :
--  Supabase > SQL Editor > New query > Coller tout ce fichier > Run
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. NETTOYAGE DES ANCIENNES TABLES / COLONNES OBSOLÈTES
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS public.drinks CASCADE;

-- Supprimer les anciennes colonnes si elles existent déjà
DO $$
BEGIN
  -- Nettoyage de public.events
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'events') THEN
    ALTER TABLE public.events DROP COLUMN IF EXISTS religious_date CASCADE;
    ALTER TABLE public.events DROP COLUMN IF EXISTS religious_time CASCADE;
    ALTER TABLE public.events DROP COLUMN IF EXISTS religious_place CASCADE;
    ALTER TABLE public.events DROP COLUMN IF EXISTS reception_date CASCADE;
    ALTER TABLE public.events DROP COLUMN IF EXISTS reception_time CASCADE;
    ALTER TABLE public.events DROP COLUMN IF EXISTS reception_place CASCADE;
    ALTER TABLE public.events DROP COLUMN IF EXISTS reception_address CASCADE;
    ALTER TABLE public.events DROP COLUMN IF EXISTS max_drinks CASCADE;
  END IF;

  -- Nettoyage de public.invitations
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'invitations') THEN
    ALTER TABLE public.invitations DROP COLUMN IF EXISTS invited_civil CASCADE;
    ALTER TABLE public.invitations DROP COLUMN IF EXISTS invited_religious CASCADE;
    ALTER TABLE public.invitations DROP COLUMN IF EXISTS invited_reception CASCADE;
    ALTER TABLE public.invitations DROP COLUMN IF EXISTS table_name CASCADE;
    ALTER TABLE public.invitations DROP COLUMN IF EXISTS drink_ids CASCADE;
    ALTER TABLE public.invitations DROP COLUMN IF EXISTS message CASCADE;
    ALTER TABLE public.invitations DROP COLUMN IF EXISTS message_at CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. CRÉATION DES TABLES
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE,

  groom_name    text NOT NULL DEFAULT 'Elvis Lusima',
  bride_name    text NOT NULL DEFAULT 'Celia Petemoya',

  civil_date    date DEFAULT '2026-12-06',
  civil_time    text,
  civil_place   text DEFAULT 'Golf Faustin, Deuxième marché, Avenue Kabongo',

  map_url       text DEFAULT 'https://www.google.com/maps/search/?api=1&query=Avenue+Kabongo+Deuxi%C3%A8me+march%C3%A9',
  rsvp_deadline date,

  welcome_text  text DEFAULT 'C''est avec une immense joie que {mariés} vous convient à célébrer leur mariage civil.',
  info_text     text DEFAULT 'Tenue de cérémonie chic & élégante. Votre présence rendra cette journée encore plus spéciale.',
  closing_text  text DEFAULT 'Au plaisir de vous retrouver pour cette occasion spéciale.' || chr(10) || 'Avec tout notre amour,',
  share_message text DEFAULT 'Bonjour {nom} 👋' || chr(10) || chr(10) || '{mariés} ont la joie de vous inviter à leur mariage civil. Voici votre invitation personnelle : vous pouvez y confirmer votre présence et le nombre de personnes.' || chr(10) || chr(10) || '{lien}',

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invitations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,

  token            text NOT NULL UNIQUE
                   DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),

  title            text,
  full_name        text NOT NULL,
  phone            text,
  email            text,
  category         text DEFAULT 'Amis',
  side             text CHECK (side IN ('groom', 'bride', 'both')),

  seats            int NOT NULL DEFAULT 1 CHECK (seats BETWEEN 1 AND 50),

  personal_message text,
  notes            text,

  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'confirmed', 'declined')),
  people_count     int NOT NULL DEFAULT 0 CHECK (people_count >= 0),
  responded_at     timestamptz,

  shared_at        timestamptz,
  first_opened_at  timestamptz,
  last_opened_at   timestamptz,
  open_count       int NOT NULL DEFAULT 0,

  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invitations_event_idx ON public.invitations(event_id);

-- ---------------------------------------------------------------------
-- 3. TRIGGER touch_updated_at
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END $$;

DROP TRIGGER IF EXISTS events_touch ON public.events;
CREATE TRIGGER events_touch BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 4. PERMISSIONS & SÉCURITÉ (RLS)
-- ---------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

ALTER TABLE public.events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS events_owner ON public.events;
CREATE POLICY events_owner ON public.events
  FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR owner_id IS NULL)
  WITH CHECK (owner_id = auth.uid() OR owner_id IS NULL);

DROP POLICY IF EXISTS invitations_owner ON public.invitations;
CREATE POLICY invitations_owner ON public.invitations
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND (e.owner_id = auth.uid() OR e.owner_id IS NULL)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND (e.owner_id = auth.uid() OR e.owner_id IS NULL)));

-- ---------------------------------------------------------------------
-- 5. FONCTIONS PUBLIQUES POUR LES INVITÉS
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_invitation(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inv public.invitations;
  ev  public.events;
BEGIN
  SELECT * INTO inv FROM public.invitations WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO ev FROM public.events WHERE id = inv.event_id;

  UPDATE public.invitations
     SET open_count      = open_count + 1,
         last_opened_at  = now(),
         first_opened_at = coalesce(first_opened_at, now())
   WHERE id = inv.id;

  RETURN jsonb_build_object(
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
END $$;

CREATE OR REPLACE FUNCTION public.submit_rsvp(
  p_token   text,
  p_status  text,
  p_people  int,
  p_message text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inv      public.invitations;
  v_people int;
BEGIN
  SELECT * INTO inv FROM public.invitations WHERE token = p_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_not_found' USING errcode = 'P0001';
  END IF;

  IF p_status NOT IN ('confirmed', 'declined') THEN
    RAISE EXCEPTION 'invalid_status' USING errcode = 'P0001';
  END IF;

  IF p_status = 'confirmed' THEN
    v_people := least(greatest(coalesce(p_people, 1), 1), inv.seats);
  ELSE
    v_people := 0;
  END IF;

  UPDATE public.invitations SET
    status       = p_status,
    people_count = v_people,
    responded_at = now()
  WHERE id = inv.id;

  RETURN jsonb_build_object(
    'status', p_status, 'people_count', v_people, 'responded_at', now()
  );
END $$;

REVOKE ALL ON FUNCTION public.get_invitation(text)               FROM public;
REVOKE ALL ON FUNCTION public.submit_rsvp(text, text, int, text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_invitation(text)               TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_rsvp(text, text, int, text) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. INITIALISATION DE L'ÉVÉNEMENT (ELVIS & CELIA)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_event_id uuid;
  v_user_id  uuid;
BEGIN
  -- Cherche un compte utilisateur existant dans auth.users
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC LIMIT 1;

  -- Cherche si un événement existe déjà
  SELECT id INTO v_event_id FROM public.events LIMIT 1;

  IF v_event_id IS NULL THEN
    INSERT INTO public.events (owner_id, groom_name, bride_name, civil_date, civil_place, map_url)
    VALUES (
      v_user_id,
      'Elvis Lusima',
      'Celia Petemoya',
      '2026-12-06',
      'Golf Faustin, Deuxième marché, Avenue Kabongo',
      'https://www.google.com/maps/search/?api=1&query=Avenue+Kabongo+Deuxi%C3%A8me+march%C3%A9'
    )
    RETURNING id INTO v_event_id;
  ELSE
    UPDATE public.events SET
      groom_name  = 'Elvis Lusima',
      bride_name  = 'Celia Petemoya',
      civil_date  = '2026-12-06',
      civil_place = 'Golf Faustin, Deuxième marché, Avenue Kabongo',
      map_url     = 'https://www.google.com/maps/search/?api=1&query=Avenue+Kabongo+Deuxi%C3%A8me+march%C3%A9',
      owner_id    = coalesce(owner_id, v_user_id),
      updated_at  = now()
    WHERE id = v_event_id;
  END IF;

  -- -------------------------------------------------------------------
  -- 7. INSERTION DES 22 INVITÉS (SI PAS DÉJÀ PRÉSENTS)
  -- -------------------------------------------------------------------
  INSERT INTO public.invitations (event_id, title, full_name, phone, seats, category)
  SELECT v_event_id, g.title, g.full_name, g.phone, g.seats, g.category
  FROM (VALUES
    ('Couple', 'Patty et Joëlle',      '0998731595', 2, 'Amis'),
    ('Couple', 'John et Jonathan',      '0846878017', 2, 'Amis'),
    ('Couple', 'Regaen et Dorcas',      '0971415745', 2, 'Amis'),
    ('Couple', 'Mubulayi',              '0854442712', 2, 'Amis'),
    ('Couple', 'Okito',                 '0840443447', 2, 'Amis'),
    ('Couple', 'Kyaku',                 '0998323511', 2, 'Amis'),
    ('Couple', 'Kashala',               '0997108999', 2, 'Amis'),
    ('Couple', 'Mpongo',                '0907159998', 2, 'Amis'),
    ('Couple', 'Heri',                  '0995253085', 2, 'Amis'),
    ('Couple', 'Nyalosaso',             '0977007153', 2, 'Amis'),
    ('Mme',    'Ange et Chekinah',      '0998871796', 2, 'Amis'),
    ('Couple', 'Dédé',                  '0994753663', 2, 'Amis'),
    ('Couple', 'Kananga',               '0822245627', 2, 'Amis'),
    ('Couple', 'Kanangila',             '0893374618', 2, 'Amis'),
    ('Couple', 'Assani',                '0971158677', 2, 'Amis'),
    ('Couple', 'Mutatshi',              '0970485226', 2, 'Amis'),
    ('Couple', 'Monga',                 '0852053742', 2, 'Amis'),
    ('Mme',    'Maïsha et Apolline',    '0828736129', 2, 'Amis'),
    ('Couple', 'Poy',                   '0992566746', 2, 'Amis'),
    ('Couple', 'Albert',                '0995830674', 2, 'Amis'),
    ('Mme',    'Mwanvua',               '0975410527', 1, 'Amis'),
    ('Mr',     'Hortense et Dorcas',    '0978585839', 2, 'Amis')
  ) AS g(title, full_name, phone, seats, category)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.invitations inv
    WHERE inv.event_id = v_event_id AND inv.full_name = g.full_name
  );

  RAISE NOTICE 'Base de données configurée avec succès pour le mariage d''Elvis Lusima & Celia Petemoya !';
END $$;

