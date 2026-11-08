-- =====================================================================
--  Mise à jour de l'événement : Mariage Civil Elvis Lusima & Celia Petemoya
--  Schéma simplifié (civil uniquement)
--  À exécuter dans : Supabase > SQL Editor > New query > Run
-- =====================================================================

UPDATE public.events SET
  groom_name    = 'Elvis Lusima',
  bride_name    = 'Celia Petemoya',

  civil_date    = '2026-12-06',
  civil_time    = NULL,
  civil_place   = 'Golf Faustin, Deuxième marché, Avenue Kabongo',

  map_url       = 'https://www.google.com/maps/search/?api=1&query=Avenue+Kabongo+Deuxi%C3%A8me+march%C3%A9',
  rsvp_deadline = NULL,

  welcome_text  = 'C''est avec une immense joie que {mariés} vous convient à célébrer leur mariage civil.',
  info_text     = 'Tenue de cérémonie chic & élégante. Votre présence rendra cette journée encore plus spéciale.',
  closing_text  = 'Au plaisir de vous retrouver pour cette occasion spéciale.' || chr(10) || 'Avec tout notre amour,',
  updated_at    = now();
