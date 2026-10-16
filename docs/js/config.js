/*
 * Configuration du site — à renseigner une fois Supabase créé
 * (Supabase > Project Settings > API).
 *
 * La clé "anon public" est faite pour être publique : la sécurité est assurée
 * par les règles RLS de supabase/schema.sql. N'utilisez JAMAIS la clé "service_role" ici.
 *
 * Tant que SUPABASE_URL est vide, le site tourne en MODE DÉMO
 * (données fictives enregistrées dans le navigateur) — pratique pour tester.
 */
window.APP_CONFIG = {
    SUPABASE_URL: 'https://wgskvafjrvoxbvmxnrxw.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_TcLK6e4tSHQw3ItBAFUDCw_iqsLxR9b',

    // Indicatif pays ajouté aux numéros commençant par 0 (243 = RDC)
    DEFAULT_COUNTRY_CODE: '243',

    // Laisser vide : l'adresse publique est déduite automatiquement.
    // À renseigner seulement si vous utilisez un domaine personnalisé différent,
    // ex. 'https://mariage-jeanine-philippe.com/'
    SITE_URL: ''
};
