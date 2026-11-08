/* Page d'invitation — chargée via le lien personnel /?i=<jeton> */

(function petals() {
    const container = document.getElementById('falling-petals');
    if (!container || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const items = ['🌸', '💕', '🌹', '❤', '💮', '♥', '🌺', '❥'];
    const count = innerWidth < 640 ? 8 : 16;
    for (let i = 0; i < count; i++) {
        const el = document.createElement('div');
        el.className = 'falling-petal';
        el.textContent = items[Math.floor(Math.random() * items.length)];
        el.style.left = (Math.random() * 96) + 'vw';
        el.style.fontSize = (Math.random() * 12 + 14) + 'px';
        el.style.animationDuration = (Math.random() * 8 + 10) + 's';
        el.style.animationDelay = (Math.random() * 12) + 's';
        container.appendChild(el);
    }
})();

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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

    Alpine.data('invitationPage', () => ({
        state: 'loading',          // loading | missing | notfound | error | ready
        demo: window.Api.isDemo,
        token: null,
        ev: {}, inv: {},

        status: null,              // null tant que l'invité n'a pas choisi
        people: 1,
        responded: false,
        respondedIso: null,

        submitting: false,
        done: false,
        err: null,
        downloading: false,
        showFab: false,
        _aos: false,

        init() {
            this.token = (new URLSearchParams(location.search).get('i') || '').trim();
            if (!this.token) { this.state = 'missing'; return; }
            this.load();
        },

        async load() {
            this.state = 'loading';
            try {
                const data = await window.Api.getInvitation(this.token);
                if (!data) { this.state = 'notfound'; return; }
                this.ev = data.event;
                this.inv = data.invitation;
                document.title = `Mariage Civil — ${C.coupleNames(this.ev)}`;

                if (this.inv.status !== 'pending') {
                    this.status = this.inv.status;
                    this.people = Math.max(this.inv.people_count || 1, 1);
                    this.responded = true;
                    this.respondedIso = this.inv.responded_at;
                }
                this.state = 'ready';
                this.$nextTick(() => this.afterReady());
            } catch (e) {
                console.error(e);
                this.state = 'error';
            }
        },

        afterReady() {
            if (window.AOS) {
                if (!this._aos) {
                    AOS.init({
                        duration: 900, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', once: true, offset: 40,
                        disable: () => matchMedia('(prefers-reduced-motion: reduce)').matches
                    });
                    this._aos = true;
                }
                AOS.refreshHard();
            }
            const hidden = new Set();
            const update = () => { this.showFab = !this.responded && hidden.size === 0 && scrollY > 320; };
            if ('IntersectionObserver' in window) {
                const io = new IntersectionObserver((entries) => {
                    entries.forEach((en) => (en.isIntersecting ? hidden.add(en.target.id) : hidden.delete(en.target.id)));
                    update();
                });
                ['invitation-actions', 'main-rsvp-form'].forEach((id) => { const n = document.getElementById(id); if (n) io.observe(n); });
            }
            addEventListener('scroll', update, { passive: true });
            this.$watch('responded', update);
            update();
        },

        /* ---------- Texte dynamique ---------- */
        get names() { return C.coupleNames(this.ev); },
        get guestName() { return C.guestLabel(this.inv); },
        get mainDate() { return C.dateLong(this.ev.civil_date); },
        get respondedAt() { return this.respondedIso ? C.dateTimeFr(this.respondedIso) : ''; },

        get welcomeHtml() {
            const tpl = this.ev.welcome_text || "C'est avec une immense joie que {mariés} vous convient à célébrer leur mariage civil.";
            return escapeHtml(tpl).replaceAll('{mariés}', `<strong class="text-stone-900">${escapeHtml(this.names)}</strong>`);
        },

        get civilLine() {
            const e = this.ev;
            if (!e.civil_date && !e.civil_place) return '';
            const when = [C.dateShort(e.civil_date), e.civil_time ? `à ${e.civil_time}` : ''].filter(Boolean).join(' ');
            return [when, e.civil_place].filter(Boolean).join(', ') + '.';
        },

        get mapUrl() {
            if (this.ev.map_url) return this.ev.map_url;
            const q = this.ev.civil_place || '';
            return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
        },

        get deadlineText() {
            const d = this.ev.rsvp_deadline;
            if (!d) return '';
            return C.daysUntil(d) < 0
                ? `La date limite de réponse (${C.dateNoDay(d)}) est dépassée — merci de répondre au plus vite.`
                : `Merci d'indiquer votre présence avant le ${C.dateNoDay(d)}.`;
        },

        get whatsappUrl() {
            return 'https://wa.me/?text=' + encodeURIComponent(`Félicitations pour le mariage civil de ${this.names} !`);
        },

        /* ---------- Actions ---------- */
        goToRsvp() {
            document.getElementById('rsvp-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },

        flashError(msg) {
            this.err = msg;
            clearTimeout(this._errT);
            this._errT = setTimeout(() => { this.err = null; }, 5000);
        },

        async submitRsvp(event) {
            event.preventDefault();
            if (this.submitting) return;
            this.err = null;
            if (!this.status) {
                this.flashError("Dites-nous d'abord si vous serez des nôtres.");
                this.goToRsvp();
                return;
            }
            this.submitting = true;
            try {
                const res = await window.Api.submitRsvp(this.token, {
                    status: this.status,
                    people: this.status === 'confirmed' ? this.people : 0
                });
                this.responded = true;
                this.respondedIso = res.responded_at;
                this.done = true;
                clearTimeout(this._doneT);
                this._doneT = setTimeout(() => { this.done = false; }, 6000);
                if (navigator.vibrate) navigator.vibrate([12, 40, 12]);
            } catch (e) {
                this.flashError(e.code && e.code !== 'unknown' ? e.message : 'Envoi impossible. Vérifiez votre connexion et réessayez.');
            } finally {
                this.submitting = false;
            }
        },

        async downloadInvitation() {
            if (this.downloading) return;
            this.downloading = true;
            const el = document.getElementById('myContent');
            try {
                await loadScript('vendor/html2canvas.min.js');
                if (document.fonts && document.fonts.ready) await document.fonts.ready;
                el.style.display = 'block';
                let canvas;
                try {
                    canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: null });
                } finally {
                    el.style.display = 'none';
                }
                const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
                const filename = 'Invitation - ' + this.guestName.replace(/[^\p{L}\p{N}]+/gu, '_') + '.png';
                const file = new File([blob], filename, { type: 'image/png' });

                if (matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) {
                    try { await navigator.share({ files: [file], title: 'Mon invitation' }); return; }
                    catch (e) { if (e.name === 'AbortError') return; }
                }
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 4000);
            } catch (e) {
                console.error(e);
                this.flashError("Impossible de générer l'image. Réessayez dans un instant.");
            } finally {
                this.downloading = false;
            }
        }
    }));
});
