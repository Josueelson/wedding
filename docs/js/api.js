/*
 * Couche d'accès aux données.
 * Deux implémentations de la MÊME interface :
 *   - Supabase (production)  : si APP_CONFIG.SUPABASE_URL est renseigné
 *   - Démo (localStorage)    : sinon, pour tester sans backend
 */
(function () {
    const cfg = window.APP_CONFIG || {};
    const C = window.Common;

    const EVENT_FIELDS = [
        'groom_name', 'bride_name',
        'civil_date', 'civil_time', 'civil_place',
        'religious_date', 'religious_time', 'religious_place',
        'reception_date', 'reception_time', 'reception_place', 'reception_address',
        'map_url', 'rsvp_deadline', 'welcome_text', 'info_text', 'closing_text',
        'share_message', 'max_drinks'
    ];
    const INV_FIELDS = [
        'title', 'full_name', 'phone', 'email', 'category', 'side', 'table_name', 'seats',
        'invited_civil', 'invited_religious', 'invited_reception',
        'personal_message', 'notes', 'status', 'people_count', 'drink_ids', 'shared_at', 'responded_at'
    ];
    const TEXT_FIELDS = new Set(['title', 'phone', 'email', 'category', 'side', 'table_name', 'personal_message', 'notes',
        'civil_date', 'civil_time', 'civil_place', 'religious_date', 'religious_time', 'religious_place',
        'reception_date', 'reception_time', 'reception_place', 'reception_address', 'map_url', 'rsvp_deadline',
        'welcome_text', 'info_text', 'closing_text', 'share_message']);

    function pick(obj, fields) {
        const out = {};
        for (const f of fields) {
            if (!(f in obj)) continue;
            let v = obj[f];
            if (typeof v === 'string') {
                v = v.trim();
                if (v === '' && TEXT_FIELDS.has(f)) v = null;
            }
            out[f] = v;
        }
        return out;
    }

    const ERRORS = {
        invitation_not_found: "Cette invitation n'existe pas ou n'est plus valide.",
        invalid_status: 'Réponse invalide.',
        too_many_drinks: 'Vous avez choisi trop de boissons.'
    };
    function apiError(err) {
        const raw = (err && (err.message || err.error_description)) || String(err);
        const code = Object.keys(ERRORS).find((k) => raw.includes(k));
        const e = new Error(code ? ERRORS[code] : raw);
        e.code = code || 'unknown';
        return e;
    }

    /* =====================================================================
     *  SUPABASE
     * ===================================================================== */
    function createSupabaseApi() {
        const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
        });
        const unwrap = ({ data, error }) => {
            if (error) throw apiError(error);
            return data;
        };

        async function fetchAll(table, orderCol) {
            const rows = [];
            for (let from = 0; ; from += 1000) {
                const page = unwrap(await sb.from(table).select('*').order(orderCol, { ascending: true }).range(from, from + 999));
                rows.push(...page);
                if (page.length < 1000) break;
            }
            return rows;
        }

        return {
            isDemo: false,

            /* ---- Public (invités) ---- */
            async getInvitation(token) {
                return unwrap(await sb.rpc('get_invitation', { p_token: token }));
            },
            async submitRsvp(token, { status, people, drinks, message }) {
                return unwrap(await sb.rpc('submit_rsvp', {
                    p_token: token, p_status: status, p_people: people,
                    p_drinks: drinks || [], p_message: message || ''
                }));
            },

            /* ---- Authentification ---- */
            auth: {
                async session() {
                    const { data } = await sb.auth.getSession();
                    return data.session ? { email: data.session.user.email } : null;
                },
                async signIn(email, password) {
                    const { error } = await sb.auth.signInWithPassword({ email, password });
                    if (error) {
                        throw new Error(/invalid login/i.test(error.message)
                            ? 'E-mail ou mot de passe incorrect.' : error.message);
                    }
                },
                async signOut() { await sb.auth.signOut(); }
            },

            /* ---- Back-office ---- */
            async loadAll() {
                let event = unwrap(await sb.from('events').select('*').limit(1).maybeSingle());
                if (!event) {
                    const { data: u } = await sb.auth.getUser();
                    const { data, error } = await sb.from('events')
                        .insert({ owner_id: u.user.id, ...pick(C.DEFAULT_EVENT, EVENT_FIELDS) })
                        .select().single();
                    if (error && error.code === '23505') {
                        event = unwrap(await sb.from('events').select('*').limit(1).single());
                    } else {
                        if (error) throw apiError(error);
                        event = data;
                    }
                }
                const [drinks, invitations] = await Promise.all([
                    sb.from('drinks').select('*').eq('event_id', event.id).order('sort').order('id').then(unwrap),
                    fetchAll('invitations', 'created_at')
                ]);
                return { event, drinks, invitations };
            },
            async saveEvent(id, patch) {
                return unwrap(await sb.from('events').update(pick(patch, EVENT_FIELDS)).eq('id', id).select().single());
            },
            async saveInvitation(eventId, inv) {
                const data = pick(inv, INV_FIELDS);
                if (inv.id) return unwrap(await sb.from('invitations').update(data).eq('id', inv.id).select().single());
                return unwrap(await sb.from('invitations').insert({ event_id: eventId, ...data }).select().single());
            },
            async importInvitations(eventId, rows) {
                const payload = rows.map((r) => ({ event_id: eventId, ...pick(r, INV_FIELDS) }));
                const out = [];
                for (let i = 0; i < payload.length; i += 200) {
                    out.push(...unwrap(await sb.from('invitations').insert(payload.slice(i, i + 200)).select()));
                }
                return out;
            },
            async deleteInvitation(id) { unwrap(await sb.from('invitations').delete().eq('id', id)); },
            async saveDrink(eventId, drink) {
                const data = { name: drink.name.trim(), kind: drink.kind, active: !!drink.active, sort: drink.sort ?? 0 };
                if (drink.id) return unwrap(await sb.from('drinks').update(data).eq('id', drink.id).select().single());
                return unwrap(await sb.from('drinks').insert({ event_id: eventId, ...data }).select().single());
            },
            async deleteDrink(id) { unwrap(await sb.from('drinks').delete().eq('id', id)); }
        };
    }

    /* =====================================================================
     *  DÉMO (localStorage) — reproduit la logique des fonctions SQL
     * ===================================================================== */
    function createDemoApi() {
        const KEY = 'wedding_demo_v1';
        const AUTH = 'wedding_demo_auth';
        const now = () => new Date().toISOString();
        const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
        const token = () => uid().replace(/-/g, '').slice(0, 12);
        const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));

        function seed() {
            const ev = { id: uid(), ...C.DEFAULT_EVENT, created_at: now(), updated_at: now() };
            const drinkNames = [['Beaufort', 'alcohol'], ['Simba', 'alcohol'], ['Chui', 'alcohol'], ['Castel', 'alcohol'],
                ['Jino', 'soft'], ['Jus de fruits', 'soft']];
            const drinks = drinkNames.map(([name, kind], i) => ({ id: i + 1, event_id: ev.id, name, kind, sort: (i + 1) * 10, active: true }));
            const base = {
                event_id: ev.id, title: null, phone: null, email: null, category: null, side: null, table_name: null, seats: 1,
                invited_civil: true, invited_religious: true, invited_reception: true, personal_message: null, notes: null,
                status: 'pending', people_count: 0, drink_ids: [], message: null, message_at: null, responded_at: null,
                shared_at: null, first_opened_at: null, last_opened_at: null, open_count: 0
            };
            const day = 86400000;
            const ago = (d) => new Date(Date.now() - d * day).toISOString();
            const list = [
                { token: 'demo', title: 'Mr', full_name: 'Serge ILUNGA', table_name: 'CHARITE', seats: 2, category: 'Amis', side: 'groom', phone: '0997001122', shared_at: ago(6) },
                { title: 'Mme', full_name: 'Grâce Mwamba', table_name: 'CHARITE', seats: 2, category: 'Famille', side: 'bride', phone: '0812345678', shared_at: ago(6),
                    status: 'confirmed', people_count: 2, drink_ids: [4, 6], responded_at: ago(4), open_count: 3, first_opened_at: ago(5),
                    message: 'Que Dieu bénisse votre union ! Nous serons là avec grande joie. 💕', message_at: ago(4) },
                { title: 'Famille', full_name: 'Kasongo', table_name: 'FOI', seats: 5, category: 'Famille', side: 'groom', phone: '0970112233', shared_at: ago(6),
                    status: 'confirmed', people_count: 4, drink_ids: [2, 7], responded_at: ago(3), open_count: 2, first_opened_at: ago(5) },
                { title: 'Dr', full_name: 'Patrick Tshibangu', table_name: 'ESPÉRANCE', seats: 2, category: 'Collègues', side: 'groom', phone: '0999887766', shared_at: ago(5),
                    status: 'confirmed', people_count: 1, drink_ids: [5, 8], responded_at: ago(2), open_count: 1, first_opened_at: ago(2),
                    message: 'Félicitations à vous deux, tous mes vœux de bonheur !', message_at: ago(2) },
                { title: 'Mlle', full_name: 'Esther Kapend', table_name: 'JOIE', seats: 1, category: 'Amis', side: 'bride', phone: '0851122334', shared_at: ago(5),
                    status: 'declined', people_count: 0, responded_at: ago(1), open_count: 1, first_opened_at: ago(1),
                    message: "Je serai à Kolwezi ce jour-là, mais mon cœur sera avec vous. Mille bénédictions !", message_at: ago(1) },
                { title: 'Mr', full_name: 'Joël Mukendi', table_name: 'JOIE', seats: 2, category: 'Amis', side: 'groom', phone: '0976543210', shared_at: ago(5),
                    status: 'confirmed', people_count: 2, drink_ids: [1, 9], responded_at: ago(1), open_count: 4, first_opened_at: ago(4) },
                { title: 'Pasteur', full_name: 'Daniel Banza', table_name: 'HONNEUR', seats: 2, category: 'Église', side: 'both', phone: '0990011223', shared_at: ago(6),
                    status: 'confirmed', people_count: 2, drink_ids: [6, 10], responded_at: ago(5), open_count: 2, first_opened_at: ago(6),
                    message: "Dieu vous garde et conduise votre foyer. Nous prierons pour vous.", message_at: ago(5) },
                { title: 'Couple', full_name: 'Ngoy & Rose', table_name: 'CHARITE', seats: 2, category: 'Famille', side: 'bride', phone: '0823344556', shared_at: ago(3), open_count: 1, first_opened_at: ago(2) },
                { title: 'Mme', full_name: 'Bénie Lukusa', seats: 1, category: 'Collègues', side: 'bride', phone: '0899001122', invited_civil: false },
                { title: 'Mr', full_name: 'Christian Kabamba', seats: 2, category: 'Voisins', side: 'groom', invited_civil: false, personal_message: 'Cher voisin, ta présence nous ferait chaud au cœur !' },
                { title: 'Prof.', full_name: 'Alain Mutombo', table_name: 'HONNEUR', seats: 2, category: 'VIP', side: 'groom', phone: '0977665544', shared_at: ago(2) },
                { title: 'Mme', full_name: 'Sylvie Mbuyi', table_name: 'ESPÉRANCE', seats: 3, category: 'Famille', side: 'bride', phone: '0816677889', shared_at: ago(2),
                    status: 'confirmed', people_count: 3, drink_ids: [3, 6], responded_at: ago(1), open_count: 2, first_opened_at: ago(1) }
            ].map((g, i) => ({ id: uid(), token: token(), ...base, ...g, created_at: ago(10 - i * 0.5) }));
            return { event: ev, drinks, invitations: list, nextDrinkId: drinks.length + 1 };
        }

        function read() {
            try {
                const raw = localStorage.getItem(KEY);
                if (raw) return JSON.parse(raw);
            } catch (e) { /* ignore */ }
            const s = seed();
            write(s);
            return s;
        }
        function write(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }
        const clone = (o) => JSON.parse(JSON.stringify(o));

        return {
            isDemo: true,
            reset() { localStorage.removeItem(KEY); },

            async getInvitation(tok) {
                await wait();
                const s = read();
                const inv = s.invitations.find((i) => i.token === tok);
                if (!inv) return null;
                inv.open_count++;
                inv.last_opened_at = now();
                inv.first_opened_at = inv.first_opened_at || inv.last_opened_at;
                write(s);
                const e = s.event;
                const ev = {};
                for (const f of [...EVENT_FIELDS]) ev[f] = e[f];
                const iv = {};
                for (const f of ['title', 'full_name', 'table_name', 'seats', 'invited_civil', 'invited_religious', 'invited_reception',
                    'personal_message', 'status', 'people_count', 'drink_ids', 'message', 'responded_at']) iv[f] = inv[f];
                return clone({
                    invitation: iv, event: ev,
                    drinks: s.drinks.filter((d) => d.active).sort((a, b) => a.sort - b.sort || a.id - b.id).map(({ id, name, kind }) => ({ id, name, kind }))
                });
            },
            async submitRsvp(tok, { status, people, drinks, message }) {
                await wait(250);
                const s = read();
                const inv = s.invitations.find((i) => i.token === tok);
                if (!inv) throw apiError(new Error('invitation_not_found'));
                if (!['confirmed', 'declined'].includes(status)) throw apiError(new Error('invalid_status'));
                let np = 0, dr = [];
                if (status === 'confirmed') {
                    np = Math.min(Math.max(people || 1, 1), inv.seats);
                    dr = s.drinks.filter((d) => d.active && (drinks || []).includes(d.id)).map((d) => d.id);
                    if (dr.length > s.event.max_drinks) throw apiError(new Error('too_many_drinks'));
                }
                const msg = (message || '').trim().slice(0, 1000) || null;
                inv.message_at = !msg ? null : msg !== inv.message ? now() : inv.message_at;
                inv.message = msg;
                Object.assign(inv, { status, people_count: np, drink_ids: dr, responded_at: now() });
                write(s);
                return { status, people_count: np, drink_ids: dr, message: msg, responded_at: inv.responded_at };
            },

            auth: {
                async session() { return sessionStorage.getItem(AUTH) ? { email: 'demo@mariage.local' } : null; },
                async signIn() { await wait(); sessionStorage.setItem(AUTH, '1'); },
                async signOut() { sessionStorage.removeItem(AUTH); }
            },

            async loadAll() {
                await wait();
                const s = read();
                return clone({ event: s.event, drinks: s.drinks.slice().sort((a, b) => a.sort - b.sort || a.id - b.id), invitations: s.invitations });
            },
            async saveEvent(id, patch) {
                await wait();
                const s = read();
                Object.assign(s.event, pick(patch, EVENT_FIELDS), { updated_at: now() });
                write(s);
                return clone(s.event);
            },
            async saveInvitation(eventId, inv) {
                await wait();
                const s = read();
                const data = pick(inv, INV_FIELDS);
                if (inv.id) {
                    const cur = s.invitations.find((i) => i.id === inv.id);
                    Object.assign(cur, data);
                    write(s);
                    return clone(cur);
                }
                const row = {
                    id: uid(), token: token(), event_id: eventId, seats: 1, invited_civil: true, invited_religious: true, invited_reception: true,
                    status: 'pending', people_count: 0, drink_ids: [], message: null, message_at: null, responded_at: null,
                    shared_at: null, first_opened_at: null, last_opened_at: null, open_count: 0, created_at: now(), ...data
                };
                s.invitations.push(row);
                write(s);
                return clone(row);
            },
            async importInvitations(eventId, rows) {
                const out = [];
                for (const r of rows) out.push(await this.saveInvitation(eventId, r));
                return out;
            },
            async deleteInvitation(id) {
                await wait();
                const s = read();
                s.invitations = s.invitations.filter((i) => i.id !== id);
                write(s);
            },
            async saveDrink(eventId, drink) {
                await wait();
                const s = read();
                const data = { name: drink.name.trim(), kind: drink.kind, active: !!drink.active, sort: drink.sort ?? 0 };
                if (drink.id) {
                    const cur = s.drinks.find((d) => d.id === drink.id);
                    Object.assign(cur, data);
                    write(s);
                    return clone(cur);
                }
                const row = { id: s.nextDrinkId++, event_id: eventId, ...data };
                s.drinks.push(row);
                write(s);
                return clone(row);
            },
            async deleteDrink(id) {
                await wait();
                const s = read();
                s.drinks = s.drinks.filter((d) => d.id !== id);
                s.invitations.forEach((i) => { i.drink_ids = i.drink_ids.filter((x) => x !== id); });
                write(s);
            }
        };
    }

    const useSupabase = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
    window.Api = useSupabase ? createSupabaseApi() : createDemoApi();
})();
