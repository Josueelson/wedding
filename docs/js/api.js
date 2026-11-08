/*
 * Couche d'accès aux données — Mariage Civil
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
        'map_url', 'rsvp_deadline',
        'welcome_text', 'info_text', 'closing_text', 'share_message'
    ];
    const INV_FIELDS = [
        'title', 'full_name', 'phone', 'email', 'category', 'side', 'seats',
        'personal_message', 'notes', 'status', 'people_count', 'shared_at', 'responded_at'
    ];
    const TEXT_FIELDS = new Set(['title', 'phone', 'email', 'category', 'side', 'personal_message', 'notes',
        'civil_date', 'civil_time', 'civil_place', 'map_url', 'rsvp_deadline',
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
        invalid_status: 'Réponse invalide.'
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
            async submitRsvp(token, { status, people }) {
                return unwrap(await sb.rpc('submit_rsvp', {
                    p_token: token, p_status: status, p_people: people, p_message: ''
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
                const invitations = await fetchAll('invitations', 'created_at');
                return { event, invitations };
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
            async deleteInvitation(id) { unwrap(await sb.from('invitations').delete().eq('id', id)); }
        };
    }

    /* =====================================================================
     *  DÉMO (localStorage)
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
            const base = {
                event_id: ev.id, title: null, phone: null, email: null, category: null, side: null, seats: 1,
                personal_message: null, notes: null,
                status: 'pending', people_count: 0, responded_at: null,
                shared_at: null, first_opened_at: null, last_opened_at: null, open_count: 0
            };
            const day = 86400000;
            const ago = (d) => new Date(Date.now() - d * day).toISOString();
            const list = [
                { token: 'demo', title: 'Couple', full_name: 'Mubulayi', seats: 2, category: 'Amis', phone: '0854442712', shared_at: ago(2) },
                { title: 'Couple', full_name: 'Okito', seats: 2, category: 'Amis', phone: '0840443447', shared_at: ago(2),
                    status: 'confirmed', people_count: 2, responded_at: ago(1) },
                { title: 'Couple', full_name: 'Kashala', seats: 2, category: 'Amis', phone: '0997108999', shared_at: ago(1),
                    status: 'declined', people_count: 0, responded_at: ago(1) },
                { title: 'Couple', full_name: 'Heri', seats: 2, category: 'Amis', phone: '0995253085' },
                { title: 'Mme', full_name: 'Mwanvua', seats: 1, category: 'Amis', phone: '0975410527', shared_at: ago(1),
                    status: 'confirmed', people_count: 1, responded_at: ago(0) }
            ].map((g, i) => ({ id: uid(), token: token(), ...base, ...g, created_at: ago(5 - i) }));
            return { event: ev, invitations: list };
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
                for (const f of ['title', 'full_name', 'seats', 'personal_message', 'status', 'people_count', 'responded_at']) iv[f] = inv[f];
                return clone({ invitation: iv, event: ev });
            },
            async submitRsvp(tok, { status, people }) {
                await wait(250);
                const s = read();
                const inv = s.invitations.find((i) => i.token === tok);
                if (!inv) throw apiError(new Error('invitation_not_found'));
                if (!['confirmed', 'declined'].includes(status)) throw apiError(new Error('invalid_status'));
                const np = status === 'confirmed' ? Math.min(Math.max(people || 1, 1), inv.seats) : 0;
                Object.assign(inv, { status, people_count: np, responded_at: now() });
                write(s);
                return { status, people_count: np, responded_at: inv.responded_at };
            },

            auth: {
                async session() { return sessionStorage.getItem(AUTH) ? { email: 'demo@mariage.local' } : null; },
                async signIn() { await wait(); sessionStorage.setItem(AUTH, '1'); },
                async signOut() { sessionStorage.removeItem(AUTH); }
            },

            async loadAll() {
                await wait();
                const s = read();
                return clone({ event: s.event, invitations: s.invitations });
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
                    id: uid(), token: token(), event_id: eventId, seats: 1,
                    status: 'pending', people_count: 0, responded_at: null,
                    shared_at: null, first_opened_at: null, last_opened_at: null, open_count: 0,
                    created_at: now(), ...data
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
            }
        };
    }

    const useSupabase = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
    window.Api = useSupabase ? createSupabaseApi() : createDemoApi();
})();
