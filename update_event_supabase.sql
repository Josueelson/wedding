-- =====================================================================
--  Mise à jour de l'événement : Mariage Coutumier Elvis Lusima & Celia Petemoya
--  À exécuter dans : Supabase > SQL Editor > New query > Run
-- =====================================================================

UPDATE public.events SET
  groom_name    = 'Elvis Lusima',
  bride_name    = 'Celia Petemoya',

  civil_date    = '2026-12-06',
  civil_time    = '16h00',
  civil_place   = 'Golf Faustin, Deuxième marché, Avenue Kabongo',

  map_url       = 'https://www.google.com/maps/search/?api=1&query=Avenue+Kabongo+Deuxi%C3%A8me+march%C3%A9',
  rsvp_deadline = NULL,

  welcome_text  = 'C''est avec une immense joie que {mariés} vous convient à célébrer leur mariage coutumier.',
  info_text     = 'Tenue de cérémonie chic & élégante. Votre présence rendra cette journée encore plus spéciale.',
  closing_text  = 'Au plaisir de vous retrouver pour cette occasion spéciale.' || chr(10) || 'Avec tout notre amour,',
  share_message = 'Bonjour {nom} 👋' || chr(10) || chr(10) || '{mariés} ont la joie de vous inviter à leur mariage coutumier. Voici votre invitation personnelle : vous pouvez y confirmer votre présence et le nombre de personnes.' || chr(10) || chr(10) || '{lien}',
  updated_at    = now();
