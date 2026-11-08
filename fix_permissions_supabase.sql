-- =====================================================================
--  RÉSOLUTION DE L'ERREUR : permission denied for schema public
--  À exécuter dans : Supabase > SQL Editor > New query > Run
-- =====================================================================

-- 1. Accorder l'usage du schéma public aux rôles de l'API Supabase
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- 2. Accorder les permissions sur les tables, fonctions et séquences
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- 3. Définir les privilèges par défaut pour les futures créations
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- 4. Droits d'exécution spécifiques sur les fonctions publiques de l'invitation
GRANT EXECUTE ON FUNCTION public.get_invitation(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_rsvp(text, text, int, text) TO anon, authenticated, service_role;

-- 5. Rechargement du cache de schéma de PostgREST
NOTIFY pgrst, 'reload schema';
