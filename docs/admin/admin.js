/* Back-office des mariés — Mariage Coutumier */

function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) return resolve();
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

document.addEventListener('alpine:init', () => {
    const C = window.Common;
    const API = window.Api;
    const sum = (arr, f) => arr.reduce((a, x) => a + (+f(x) || 0), 0);
    const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const nowIso = () => new Date().toISOString();
    const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
    const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

    const SETTINGS_FIELDS = ['groom_name', 'bride_name',
        'civil_date', 'civil_time', 'civil_place',
        'map_url', 'rsvp_deadline',
        'welcome_text', 'info_text', 'closing_text', 'share_message'];

    const EMPTY_GUEST = () => ({
        id: null, title: '', full_name: '', phone: '', email: '', category: '', side: '', seats: 1,
        personal_message: '', notes: '', status: 'pending', people_count: 1
    });

    Alpine.data('admin', () => ({
        Common: C,
        demo: API.isDemo,
        titles: { home: 'Accueil', guests: 'Invités', settings: 'Réglages' },

        /* ----- état ----- */
        booting: true, user: null,
        loginEmail: '', loginPass: '', loginErr: '', loggingIn: false, showPass: false,
        loading: false, loadErr: null, lastLoad: 0,
        event: null, guests: [],
        tab: 'home',
        q: '', filter: 'all', sort: 'name', catFilter: '',
        sd: {}, sdOrig: '{}', sec: '',
        saving: false, toasts: [], _tid: 0,

        // feuilles
        stack: [], detailId: null,
        form: null, fe: {},
        shareId: null, shareText: '', shareQueue: [], shareFromQueue: false, qrOpen: false,
        importText: '', importRows: [], importSkipped: 0,
        confirmDlg: null,

        /* =================================================================
         *  Démarrage / authentification
         * ================================================================= */
        async init() {
            const saved = lsGet('wedding_admin_tab');
            if (saved && this.titles[saved]) this.tab = saved;
            history.replaceState({ depth: 0 }, '');
            addEventListener('popstate', () => this.onPop());
            this.$watch('stack.length', (n) => document.documentElement.classList.toggle('sheet-open', n > 0));
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible' && this.user && Date.now() - this.lastLoad > 60000) this.refresh(false);
            });
            try { this.user = await API.auth.session(); } catch (e) { this.user = null; }
            this.booting = false;
            if (this.user) this.refresh(true);
        },

        async login() {
            if (this.loggingIn) return;
            this.loginErr = '';
            this.loggingIn = true;
            try {
                await API.auth.signIn(this.loginEmail.trim(), this.loginPass);
                this.user = await API.auth.session();
                this.loginPass = '';
                this.refresh(true);
            } catch (e) {
                this.loginErr = e.message || 'Connexion impossible.';
            } finally {
                this.loggingIn = false;
            }
        },
        async demoLogin() {
            this.loginEmail = 'demo@mariage.local';
            this.loginPass = 'demo';
            await this.login();
        },
        async logout() {
            await API.auth.signOut();
            this.closeAll();
            this.user = null;
            this.event = null;
            this.guests = [];
            this.sd = {};
            this.sdOrig = '{}';
            this.tab = 'home';
        },
        resetDemo() {
            API.reset();
            this.sd = {};
            this.sdOrig = '{}';
            this.refresh(true);
            this.toast('Données de démo réinitialisées');
        },

        /* =================================================================
         *  Données
         * ================================================================= */
        async refresh(force) {
            if (this.loading) return;
            this.loading = true;
            try {
                const d = await API.loadAll();
                this.event = d.event;
                this.guests = d.invitations;
                this.lastLoad = Date.now();
                this.loadErr = null;
                if (!this.sdDirty) this.loadSettings();
            } catch (e) {
                console.error(e);
                if (/jwt|not authenticated|expired/i.test(e.message)) { this.logout(); return; }
                if (!this.event) this.loadErr = e.message || 'Impossible de charger les données. Vérifiez votre connexion.';
                else this.toast('Actualisation impossible', 'err');
            } finally {
                this.loading = false;
            }
        },

        toast(msg, type = 'ok') {
            const id = ++this._tid;
            this.toasts.push({ id, msg, type });
            setTimeout(() => { this.toasts = this.toasts.filter((t) => t.id !== id); }, type === 'err' ? 4500 : 2800);
        },
        buzz(p = 10) { if (navigator.vibrate) navigator.vibrate(p); },
        fail(e, fallback = 'Une erreur est survenue') {
            console.error(e);
            this.toast(e && e.message ? e.message : fallback, 'err');
        },

        /* =================================================================
         *  Navigation & pile de feuilles
         * ================================================================= */
        setTab(t) {
            if (this.stack.length) this.closeAll();
            this.tab = t;
            lsSet('wedding_admin_tab', t);
            scrollTo({ top: 0 });
        },
        goGuests(f) {
            this.tab = 'guests';
            lsSet('wedding_admin_tab', 'guests');
            this.filter = f;
            this.q = '';
            this.catFilter = '';
            scrollTo({ top: 0 });
        },
        isOpen(name) { return this.stack.includes(name); },
        open(name) {
            this.stack.push(name);
            history.pushState({ depth: this.stack.length }, '');
        },
        swap(name) {
            this.stack[this.stack.length - 1] = name;
            history.replaceState({ depth: this.stack.length }, '');
        },
        closeTop() { if (this.stack.length) history.back(); },
        closeAll() {
            const n = this.stack.length;
            if (!n) return;
            this.stack = [];
            history.go(-n);
        },
        escClose(name) { if (this.stack[this.stack.length - 1] === name) this.closeTop(); },
        onPop() {
            const d = (history.state && history.state.depth) || 0;
            if (this.stack.length > d) this.stack = this.stack.slice(0, d);
            if (!this.isOpen('share')) { this.shareQueue = []; this.shareFromQueue = false; }
        },

        /* =================================================================
         *  Libellés
         * ================================================================= */
        label(g) { return C.guestLabel(g); },
        initials(g) {
            const w = String(g.full_name || '').split(/[\s&]+/).filter((x) => /^\p{L}/u.test(x));
            return ((w[0] || '?')[0] + (w[1] ? w[1][0] : '')).toUpperCase();
        },
        statusLabel(g) {
            if (g.status === 'confirmed') return 'Présent(e)';
            if (g.status === 'declined') return 'Absent(e)';
            return g.shared_at ? 'En attente' : 'À envoyer';
        },
        metaLine(g) {
            return [
                g.category,
                g.status === 'confirmed' ? `${g.people_count}/${g.seats} pers.` : g.seats > 1 ? `${g.seats} places` : ''
            ].filter(Boolean).join(' · ');
        },
        fmtTs(ts) { return C.dateTimeFr(ts); },
        byName(a, b) { return norm(a.full_name).localeCompare(norm(b.full_name)); },
        sumPeople(list) { return sum(list.filter((g) => g.status === 'confirmed'), (g) => g.people_count); },

        /* =================================================================
         *  Statistiques (accueil)
         * ================================================================= */
        get mainDate() { return C.dateLong((this.event || {}).civil_date); },
        get countdown() {
            const d = C.daysUntil((this.event || {}).civil_date);
            if (d === null) return null;
            if (d > 1) return { n: d, label: 'jours restants' };
            if (d === 1) return { n: 1, label: 'jour restant' };
            if (d === 0) return { n: '🎉', label: "c'est aujourd'hui" };
            return { n: '✓', label: 'jour J passé' };
        },
        get st() {
            const g = this.guests;
            const confirmed = g.filter((x) => x.status === 'confirmed');
            const declined = g.filter((x) => x.status === 'declined');
            const pending = g.filter((x) => x.status === 'pending');
            const total = g.length || 1;
            const people = sum(confirmed, (x) => x.people_count);
            const capacity = sum(g.filter((x) => x.status !== 'declined'), (x) => x.seats);
            return {
                confirmed, declined, pending, people, capacity,
                seats: sum(g, (x) => x.seats),
                rate: g.length ? Math.round(((confirmed.length + declined.length) / g.length) * 100) : 0,
                pctConfirmed: (confirmed.length / total) * 100,
                pctDeclined: (declined.length / total) * 100,
                pctCapacity: capacity ? Math.min(100, (people / capacity) * 100) : 0,
                opened: pending.filter((x) => x.open_count > 0).length,
                unshared: g.filter((x) => !x.shared_at).length,
                awaiting: g.filter((x) => x.status === 'pending' && x.shared_at)
            };
        },
        get todos() {
            const s = this.st, t = [];
            if (!this.guests.length) t.push({ icon: 'fa-user-plus', text: 'Ajoutez votre premier invité', btn: 'Ajouter', fn: () => this.openForm() });
            if (s.unshared) t.push({ icon: 'fa-paper-plane', text: `${plural(s.unshared, 'invitation pas encore envoyée', 'invitations pas encore envoyées')}`, btn: 'Envoyer', fn: () => this.startQueue() });
            if (s.awaiting.length) t.push({ icon: 'fa-bell', text: `${plural(s.awaiting.length, "invité n'a pas encore répondu", "invités n'ont pas encore répondu")}`, btn: 'Relancer', fn: () => this.goGuests('awaiting') });
            const d = C.daysUntil(this.event && this.event.rsvp_deadline);
            if (d !== null && s.pending.length) {
                if (d < 0) t.push({ icon: 'fa-hourglass-end', text: `Date limite dépassée : ${s.pending.length} sans réponse`, btn: 'Voir', fn: () => this.goGuests('pending') });
                else if (d <= 14) t.push({ icon: 'fa-hourglass-half', text: d === 0 ? "Date limite de réponse : aujourd'hui" : `Date limite dans ${plural(d, 'jour', 'jours')}`, btn: 'Voir', fn: () => this.goGuests('pending') });
            }
            return t;
        },

        /* =================================================================
         *  Invités : filtres & tri
         * ================================================================= */
        get filters() {
            const s = this.st;
            return [
                { key: 'all', label: 'Tous', count: this.guests.length },
                { key: 'confirmed', label: 'Présents', count: s.confirmed.length },
                { key: 'declined', label: 'Absents', count: s.declined.length },
                { key: 'pending', label: 'En attente', count: s.pending.length },
                { key: 'awaiting', label: 'À relancer', count: s.awaiting.length },
                { key: 'unshared', label: 'Non envoyés', count: s.unshared }
            ];
        },
        get categories() { return [...new Set(this.guests.map((g) => g.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')); },
        get allCategories() { return [...new Set([...C.CATEGORIES, ...this.categories])]; },
        get filteredGuests() {
            const q = norm(this.q);
            const digits = this.q.replace(/\D/g, '');
            let list = this.guests.filter((g) => {
                if (this.filter === 'confirmed' && g.status !== 'confirmed') return false;
                if (this.filter === 'declined' && g.status !== 'declined') return false;
                if (this.filter === 'pending' && g.status !== 'pending') return false;
                if (this.filter === 'awaiting' && !(g.status === 'pending' && g.shared_at)) return false;
                if (this.filter === 'unshared' && g.shared_at) return false;
                if (this.catFilter && g.category !== this.catFilter) return false;
                if (!q) return true;
                return norm([g.title, g.full_name, g.category, g.email].join(' ')).includes(q)
                    || (digits.length >= 3 && String(g.phone || '').replace(/\D/g, '').includes(digits));
            });
            if (this.sort === 'name') list = list.sort(this.byName);
            else list = list.sort((a, b) => b.created_at.localeCompare(a.created_at));
            return list;
        },

        /* =================================================================
         *  Fiche invité
         * ================================================================= */
        get cur() { return this.guests.find((g) => g.id === this.detailId) || null; },
        openDetail(g) {
            this.detailId = g.id;
            if (!this.isOpen('detail')) this.open('detail');
        },
        replaceGuest(row) {
            const i = this.guests.findIndex((g) => g.id === row.id);
            if (i >= 0) this.guests[i] = row; else this.guests.push(row);
        },
        async quickStatus(g, status) {
            if (g.status === status) return;
            const confirmed = status === 'confirmed';
            try {
                const row = await API.saveInvitation(this.event.id, {
                    id: g.id, status,
                    people_count: confirmed ? Math.min(Math.max(g.people_count || 1, 1), g.seats) : 0,
                    responded_at: status === 'pending' ? null : nowIso()
                });
                this.replaceGuest(row);
                this.buzz();
                this.toast('Statut mis à jour');
            } catch (e) { this.fail(e); }
        },
        askDelete(g) {
            this.confirmDlg = {
                title: 'Supprimer cet invité ?',
                text: `${this.label(g)} et sa réponse seront définitivement supprimés. Son lien personnel cessera de fonctionner.`,
                label: 'Supprimer',
                fn: async () => {
                    this.saving = true;
                    try {
                        await API.deleteInvitation(g.id);
                        this.guests = this.guests.filter((x) => x.id !== g.id);
                        this.closeAll();
                        this.toast('Invité supprimé');
                    } catch (e) { this.fail(e); } finally { this.saving = false; }
                }
            };
            this.open('confirm');
        },

        /* =================================================================
         *  Formulaire invité
         * ================================================================= */
        openForm(g) {
            this.fe = {};
            if (g) {
                const f = { ...EMPTY_GUEST(), ...g };
                for (const k of ['title', 'phone', 'email', 'category', 'side', 'personal_message', 'notes']) f[k] = f[k] || '';
                f.people_count = Math.max(g.people_count || 1, 1);
                this.form = f;
            } else {
                this.form = EMPTY_GUEST();
            }
            this.open('form');
            if (matchMedia('(pointer: fine)').matches) setTimeout(() => document.getElementById('f-name')?.focus(), 350);
        },
        clampPeople() { if (this.form.people_count > this.form.seats) this.form.people_count = +this.form.seats; },
        async saveGuest() {
            if (this.saving) return;
            const f = this.form;
            const fe = {};
            if (!f.full_name.trim()) fe.full_name = 'Le nom est obligatoire.';
            this.fe = fe;
            if (Object.keys(fe).length) {
                this.toast('Vérifiez les champs en rouge', 'err');
                return;
            }
            const seats = Math.min(Math.max(parseInt(f.seats, 10) || 1, 1), 50);
            const payload = {
                id: f.id, title: f.title, full_name: f.full_name, phone: f.phone,
                email: f.email || '', category: f.category, side: f.side, seats,
                personal_message: f.personal_message, notes: f.notes
            };
            if (f.id) {
                const before = this.guests.find((g) => g.id === f.id);
                payload.status = f.status;
                payload.people_count = f.status === 'confirmed' ? Math.min(Math.max(+f.people_count || 1, 1), seats) : 0;
                if (before && before.status !== f.status) payload.responded_at = f.status === 'pending' ? null : nowIso();
            }
            this.saving = true;
            try {
                const row = await API.saveInvitation(this.event.id, payload);
                const isNew = !f.id;
                this.replaceGuest(row);
                this.buzz([10, 30, 10]);
                if (isNew) {
                    this.detailId = row.id;
                    this.shareGuest(row, false, true);
                    this.toast('Invitation créée — partagez-la maintenant');
                } else {
                    this.closeTop();
                    this.toast('Modifications enregistrées');
                }
            } catch (e) { this.fail(e); } finally { this.saving = false; }
        },

        /* =================================================================
         *  Partage
         * ================================================================= */
        get shareGuestObj() { return this.guests.find((g) => g.id === this.shareId) || null; },
        get shareUrl() { return this.shareGuestObj ? C.inviteUrl(this.shareGuestObj.token) : ''; },
        get canNativeShare() { return !!navigator.share; },
        get waHref() {
            const n = C.waNumber(this.shareGuestObj && this.shareGuestObj.phone);
            return `https://wa.me/${n}?text=${encodeURIComponent(this.shareText)}`;
        },
        get smsHref() {
            const n = C.waNumber(this.shareGuestObj && this.shareGuestObj.phone);
            return `sms:${n ? '+' + n : ''}?body=${encodeURIComponent(this.shareText)}`;
        },
        get mailHref() {
            const g = this.shareGuestObj || {};
            return `mailto:${g.email || ''}?subject=${encodeURIComponent('Invitation au mariage coutumier de ' + C.coupleNames(this.event))}&body=${encodeURIComponent(this.shareText)}`;
        },
        shareGuest(g, fromQueue = false, replaceTop = false) {
            this.shareId = g.id;
            let text = C.renderShareMessage(this.event.share_message, this.event, g);
            const url = C.inviteUrl(g.token);
            if (!text.includes(url)) text += '\n\n' + url;
            this.shareText = text;
            this.qrOpen = false;
            this.shareFromQueue = fromQueue;
            if (!fromQueue) this.shareQueue = [];
            if (this.isOpen('share')) return;
            if (replaceTop) this.swap('share'); else this.open('share');
        },
        startQueue() {
            const ids = this.guests.filter((g) => !g.shared_at).sort((a, b) => a.created_at.localeCompare(b.created_at)).map((g) => g.id);
            if (!ids.length) return this.toast('Toutes les invitations ont été envoyées 🎉');
            this.shareQueue = ids.slice(1);
            this.shareGuest(this.guests.find((g) => g.id === ids[0]), true);
        },
        nextInQueue() {
            if (this.shareQueue.length) {
                const id = this.shareQueue.shift();
                const g = this.guests.find((x) => x.id === id);
                if (g) this.shareGuest(g, true);
            } else {
                this.closeTop();
                this.toast('Envois terminés 🎉');
            }
        },
        async markShared(g) {
            if (!g || g.shared_at) return;
            const stamp = nowIso();
            g.shared_at = stamp;
            try { await API.saveInvitation(this.event.id, { id: g.id, shared_at: stamp }); }
            catch (e) { g.shared_at = null; }
        },
        async toggleShared(g) {
            const val = g.shared_at ? null : nowIso();
            const old = g.shared_at;
            g.shared_at = val;
            try { await API.saveInvitation(this.event.id, { id: g.id, shared_at: val }); }
            catch (e) { g.shared_at = old; this.fail(e); }
        },
        async nativeShare() {
            try {
                await navigator.share({ title: 'Invitation au mariage coutumier de ' + C.coupleNames(this.event), text: this.shareText });
                this.markShared(this.shareGuestObj);
            } catch (e) { /* annulé */ }
        },
        async copy(text, msg = 'Copié') {
            try {
                await navigator.clipboard.writeText(text);
            } catch (e) {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;opacity:0';
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); } catch (err) { /* ignore */ }
                ta.remove();
            }
            this.buzz();
            this.toast(msg);
        },
        async toggleQr() {
            this.qrOpen = !this.qrOpen;
            if (!this.qrOpen) return;
            try {
                await loadScript('../vendor/qrcode.min.js');
                await this.$nextTick();
                const el = this.$refs.qr;
                el.innerHTML = '';
                new QRCode(el, { text: this.shareUrl, width: 196, height: 196, correctLevel: QRCode.CorrectLevel.M });
            } catch (e) { this.fail(e, 'QR code indisponible'); }
        },

        /* =================================================================
         *  Import / export
         * ================================================================= */
        openImport() { this.importText = ''; this.importRows = []; this.importSkipped = 0; this.open('import'); },
        parseImport() {
            const existing = new Set(this.guests.map((g) => norm(C.guestLabel(g))));
            const rows = [];
            let skipped = 0;
            const lines = this.importText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
            lines.forEach((line, idx) => {
                let parts = line.split(/\t|;/);
                if (parts.length === 1 && line.includes(',')) parts = line.split(',');
                parts = parts.map((p) => p.trim());
                if (idx === 0 && /^(nom|name|noms)\b/i.test(parts[0])) return;
                let name = parts[0];
                if (!name) { skipped++; return; }
                let title = '';
                const m = /^(\S+)\s+(.+)$/.exec(name);
                if (m) {
                    const t = C.TITLES.find((x) => x.toLowerCase().replace('.', '') === m[1].toLowerCase().replace('.', ''));
                    if (t) { title = t; name = m[2]; }
                }
                const key = norm(`${title} ${name}`);
                if (existing.has(key)) { skipped++; return; }
                existing.add(key);
                let seats = 1;
                let category = '';
                if (parts[2] && /^\d+$/.test(parts[2].trim())) {
                    seats = parseInt(parts[2].trim(), 10);
                    category = parts[3] || '';
                } else if (parts[3] && /^\d+$/.test(parts[3].trim())) {
                    seats = parseInt(parts[3].trim(), 10);
                    category = parts[4] || '';
                } else if (parts[2]) {
                    category = parts[2];
                }
                seats = Math.min(Math.max(seats || 1, 1), 50);
                rows.push({ title, full_name: name, phone: parts[1] || '', seats, category: category.trim() });
            });
            this.importRows = rows;
            this.importSkipped = skipped;
        },
        async doImport() {
            if (!this.importRows.length || this.saving) return;
            this.saving = true;
            try {
                const created = await API.importInvitations(this.event.id, this.importRows);
                this.guests.push(...created);
                this.closeTop();
                this.goGuests('unshared');
                this.toast(`${plural(created.length, 'invité importé', 'invités importés')} — prêts à être envoyés`);
            } catch (e) { this.fail(e); } finally { this.saving = false; }
        },
        exportCsv() {
            if (!this.guests.length) return this.toast('Aucun invité à exporter', 'err');
            const head = ['Civilité', 'Nom', 'Téléphone', 'E-mail', 'Catégorie', 'Côté', 'Places réservées', 'Statut',
                'Personnes présentes', 'Lien personnel', 'Envoyée le', 'Ouvertures', 'Répondu le', 'Notes'];
            const st = { confirmed: 'Présent', declined: 'Absent', pending: 'En attente' };
            const rows = this.guests.slice().sort(this.byName).map((g) => [
                g.title, g.full_name, g.phone, g.email, g.category, g.side ? C.SIDES[g.side] : '',
                g.seats, st[g.status], g.people_count,
                C.inviteUrl(g.token),
                g.shared_at ? C.dateTimeFr(g.shared_at) : '', g.open_count,
                g.responded_at ? C.dateTimeFr(g.responded_at) : '', g.notes
            ]);
            const csv = '\uFEFF' + [head, ...rows].map((r) => r.map(C.csvCell).join(';')).join('\r\n');
            const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `invites-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
            this.toast('Export téléchargé');
        },

        /* =================================================================
         *  Réglages
         * ================================================================= */
        loadSettings() {
            const sd = {};
            for (const k of SETTINGS_FIELDS) sd[k] = this.event[k] == null ? '' : this.event[k];
            this.sd = sd;
            this.sdOrig = JSON.stringify(sd);
        },
        get sdDirty() { return JSON.stringify(this.sd) !== this.sdOrig; },
        resetSettings() { this.loadSettings(); },
        get previewUrl() { return this.guests.length ? C.inviteUrl(this.guests[0].token) : C.siteBase(); },
        get settingSections() {
            const sd = this.sd || {};
            return [
                { id: 'couple', icon: 'fa-heart', title: 'Les mariés', sub: `${sd.groom_name || ''} & ${sd.bride_name || ''}` },
                { id: 'dates', icon: 'fa-calendar-days', title: 'Mariage coutumier — Lieu, date & heure', sub: C.dateLong(sd.civil_date) || 'Date, heure, adresse' },
                { id: 'texts', icon: 'fa-pen-fancy', title: "Textes de l'invitation", sub: 'Accueil, informations, mot de fin' },
                { id: 'rsvp', icon: 'fa-reply', title: 'Réponses des invités', sub: sd.rsvp_deadline ? 'Avant le ' + C.dateNoDay(sd.rsvp_deadline) : 'Date limite de réponse' },
                { id: 'share', icon: 'fa-share-nodes', title: "Message d'envoi", sub: 'Modèle WhatsApp / SMS' },
                { id: 'account', icon: 'fa-user-lock', title: 'Compte', sub: this.user ? this.user.email : '' }
            ];
        },
        async saveSettings() {
            const sd = this.sd;
            if (!sd.bride_name.trim() || !sd.groom_name.trim()) { this.sec = 'couple'; return this.toast('Les deux prénoms sont obligatoires', 'err'); }
            if (!String(sd.share_message || '').includes('{lien}')) { this.sec = 'share'; return this.toast('Le message d\'envoi doit contenir {lien}', 'err'); }
            this.saving = true;
            try {
                this.event = await API.saveEvent(this.event.id, sd);
                this.loadSettings();
                this.buzz([10, 30, 10]);
                this.toast('Réglages enregistrés');
            } catch (e) { this.fail(e); } finally { this.saving = false; }
        }
    }));
});
