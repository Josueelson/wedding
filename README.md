# Invitation de Mariage Coutumier — Elvis Lushima & Celia Petemoya

Site d'invitation personnalisée + back-office pour les mariés (version mariage coutumier).
Hébergement : **GitHub Pages** (dossier `docs/`) · Base de données : **Supabase**.

```
docs/
  index.html            Invitation de l'invité  →  /?i=<jeton>
  admin/                Back-office des mariés  →  /admin/
  js/config.js          ⚙️ Configuration (URL + clé Supabase)
  assets/images/        Photos et habillage (photo du couple : elvis.jpg)
  vendor/               Librairies et polices embarquées (aucun CDN requis)
supabase/
  schema.sql            Schéma Supabase (tables, sécurité RLS, fonctions publiques)
```

## 1. Essayer tout de suite (mode démo)

Tant que `docs/js/config.js` est vide ou non connecté, tout fonctionne en **mode démo local** (données stockées dans votre navigateur) :

```bash
cd docs && python -m http.server 8080
# Invitation :  http://localhost:8080/?i=demo
# Back-office : http://localhost:8080/admin/   → cliquer « Entrer en mode démo »
```

## 2. Déploiement en production

### a) Supabase
1. Créez un projet sur [supabase.com](https://supabase.com).
2. Dans **SQL Editor → New query** : copiez-collez `setup_complete_supabase.sql` (ou `supabase/schema.sql`) puis cliquez sur **Run**.
3. Dans **Authentication → Users → Add user** : créez votre compte administrateur (e-mail + mot de passe, cochez *Auto Confirm User*).
4. Dans **Authentication → Sign In / Providers → Email** : désactivez **« Allow new users to sign up »**.
5. Dans **Project Settings → API** : copiez l'URL du projet et la clé **anon public**.

### b) Configuration locale
Dans `docs/js/config.js` :
```js
window.APP_CONFIG = {
    SUPABASE_URL: 'https://votre-projet.supabase.co',
    SUPABASE_ANON_KEY: 'votre_cle_anon_public',
    DEFAULT_COUNTRY_CODE: '243',
    SITE_URL: ''
};
```

### c) GitHub Pages
Poussez le projet sur GitHub, puis :
**Settings → Pages → Build and deployment → Source : Deploy from a branch → branche `main` / dossier `/docs`**.
- URL de l'invitation : `https://<compte>.github.io/<depot>/?i=<jeton>`
- URL du back-office : `https://<compte>.github.io/<depot>/admin/`

## 3. Back-office des mariés (`/admin/`)

Le back-office est optimisé pour mobile (PWA ajoutable à l'écran d'accueil) avec **3 onglets** :

| Onglet | Fonctionnalités |
|---|---|
| **Accueil** | Compte à rebours du 06/12/2026, décompte présents/absents/en attente, barre de progression des confirmations, alertes d'envois et relances. |
| **Invités** | Liste complète, recherche rapide, filtres (présents, absents, à relancer, non envoyés), ajout individuel, import groupé, export CSV, partage direct WhatsApp/SMS/QR code. |
| **Réglages** | Prénoms des mariés, date, heure (16h00) et lieu du mariage coutumier, lien Google Maps, date limite RSVP, textes d'accueil et de fin, modèle du message d'envoi. |

## 4. Format d'import des invités

Pour importer facilement votre liste d'invités dans le back-office (**Invités > Importer**) :
```
Couple Patty et Joëlle ; 0998731595 ; 2 ; Amis
Mme Mwanvua ; 0975410527 ; 1 ; Amis
```
*(Nom ; Téléphone ; Places ; Catégorie)*
