/* Utilitaires partagés entre la page d'invitation et le back-office */
(function () {
    const cfg = window.APP_CONFIG || {};
    const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

    // 'YYYY-MM-DD' -> Date locale (évite le décalage de fuseau de new Date('2026-11-01'))
    function parseDate(iso) {
        if (!iso) return null;
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
        return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
    }
    const dayNum = (d) => (d.getDate() === 1 ? '1er' : String(d.getDate()));

    // "dimanche 1er novembre"
    function dateShort(iso) {
        const d = parseDate(iso);
        return d ? `${DAYS[d.getDay()]} ${dayNum(d)} ${MONTHS[d.getMonth()]}` : '';
    }
    // "dimanche 1er novembre 2026"
    function dateLong(iso) {
        const d = parseDate(iso);
        return d ? `${dateShort(iso)} ${d.getFullYear()}` : '';
    }
    // "1er novembre 2026"
    function dateNoDay(iso) {
        const d = parseDate(iso);
        return d ? `${dayNum(d)} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '';
    }
    function daysUntil(iso) {
        const d = parseDate(iso);
        if (!d) return null;
        const t = new Date();
        const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
        return Math.round((d - today) / 86400000);
    }
    const MONTHS_ABBR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
    function dateTimeFr(isoTs) {
        if (!isoTs) return '';
        const d = new Date(isoTs);
        return `${d.getDate()} ${MONTHS_ABBR[d.getMonth()]} à ${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`;
    }

    // Numéro pour wa.me : chiffres uniquement, avec indicatif pays
    function waNumber(phone) {
        if (!phone) return '';
        const cc = String(cfg.DEFAULT_COUNTRY_CODE || '243');
        let s = String(phone).trim();
        const plus = s.startsWith('+');
        let digits = s.replace(/\D/g, '');
        if (!digits) return '';
        if (plus) return digits;
        if (digits.startsWith('00')) return digits.slice(2);
        if (digits.startsWith('0')) return cc + digits.slice(1);
        if (digits.length <= 9) return cc + digits;
        return digits;
    }

    const guestLabel = (g) => [g.title, g.full_name].filter(Boolean).join(' ').trim();

    // Adresse publique de la page d'invitation (dossier parent de /admin/)
    function siteBase() {
        if (cfg.SITE_URL) return cfg.SITE_URL.replace(/\/?$/, '/');
        const u = new URL(location.href);
        u.hash = '';
        u.search = '';
        u.pathname = u.pathname.replace(/admin\/(index\.html)?$/, '').replace(/index\.html$/, '');
        if (!u.pathname.endsWith('/')) u.pathname += '/';
        return u.toString();
    }
    const inviteUrl = (token) => `${siteBase()}?i=${encodeURIComponent(token)}`;

    const coupleNames = (ev) => `${ev.groom_name} et ${ev.bride_name}`;

    const DEFAULT_SHARE_MESSAGE =
        'Bonjour {nom} 👋\n\n{mariés} ont la joie de vous inviter à leur mariage. ' +
        'Voici votre invitation personnelle : vous pouvez y confirmer votre présence, ' +
        'choisir vos boissons et laisser un mot aux mariés.\n\n{lien}';

    function renderShareMessage(tpl, ev, guest) {
        return (tpl || DEFAULT_SHARE_MESSAGE)
            .replaceAll('{nom}', guestLabel(guest))
            .replaceAll('{mariés}', coupleNames(ev))
            .replaceAll('{date}', dateLong(ev.religious_date || ev.reception_date || ev.civil_date))
            .replaceAll('{lien}', inviteUrl(guest.token));
    }

    // Valeurs initiales d'un nouvel événement (mariage de démonstration)
    const DEFAULT_EVENT = {
        groom_name: 'Philippe',
        bride_name: 'Jeanine',
        civil_date: '2026-10-30',
        civil_time: '8h30',
        civil_place: 'commune de Kamalondo',
        religious_date: '2026-11-01',
        religious_time: '8h30',
        religious_place: "avenue Biayi, contre Kalemie quartier Kamatete, en diagonale de l'école l'émission aire",
        reception_date: '2026-11-01',
        reception_time: '18h30',
        reception_place: 'Salle Bunker',
        reception_address: "Avenue du 30 Juin, avant l'église Saint Marc",
        map_url: 'https://www.google.com/maps/search/?api=1&query=Salle+Bunker+avenue+du+30+Juin+église+Saint+Marc+Lubumbashi',
        rsvp_deadline: '2026-10-25',
        welcome_text: "C'est avec une immense joie que {mariés} vous convient à célébrer leur union.",
        info_text: "Tenue de cérémonie chic & élégante. Votre présence rendra cette journée encore plus spéciale.\n\nMerci de respecter l'horaire : la salle n'est disponible que 4 heures.",
        closing_text: "Au plaisir de vous retrouver pour cette occasion spéciale.\nAvec tout notre amour,",
        share_message: DEFAULT_SHARE_MESSAGE,
        max_drinks: 2
    };

    const TITLES = ['Mr', 'Mme', 'Mlle', 'Dr', 'Me', 'Pasteur', 'Prof.', 'Famille', 'Couple'];
    const CATEGORIES = ['Famille', 'Amis', 'Collègues', 'Église', 'Voisins', 'VIP'];
    const SIDES = { groom: 'Côté marié', bride: 'Côté mariée', both: 'Les deux côtés' };

    // Échappe une cellule CSV (séparateur ;, compatible Excel FR)
    const csvCell = (v) => {
        let s = v == null ? '' : String(v);
        if (/^[=+\-@]/.test(s)) s = "'" + s; // neutralise l'injection de formules
        return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    window.Common = {
        parseDate, dateShort, dateLong, dateNoDay, daysUntil, dateTimeFr,
        waNumber, guestLabel, siteBase, inviteUrl, coupleNames,
        renderShareMessage, DEFAULT_SHARE_MESSAGE, DEFAULT_EVENT,
        TITLES, CATEGORIES, SIDES, csvCell,
        cc: String(cfg.DEFAULT_COUNTRY_CODE || '243')
    };
})();
