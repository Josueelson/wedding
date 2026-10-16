# Invitation de mariage — Philippe & Jeanine

Site d'invitation personnalisée + back-office pour les mariés.
Hébergement : **GitHub Pages** (dossier `docs/`) · Base de données : **Supabase**.

```
docs/
  index.html            Invitation de l'invité  →  /?i=<jeton>
  admin/                Back-office des mariés  →  /admin/
  js/config.js          ⚙️ À renseigner (URL + clé Supabase)
  vendor/               Librairies et polices embarquées (aucun CDN)
supabase/schema.sql     Tables, sécurité (RLS), fonctions publiques
```

## 1. Essayer tout de suite (mode démo)

Tant que `docs/js/config.js` est vide, tout fonctionne avec des **données fictives enregistrées dans le navigateur** :

```bash
cd docs && python3 -m http.server 8080
# Invitation :  http://localhost:8080/?i=demo
# Back-office : http://localhost:8080/admin/   → « Entrer en mode démo »
```

## 2. Mettre en production

### a) Supabase
1. Créez un projet sur supabase.com.
2. **SQL Editor → New query** : collez `supabase/schema.sql` → **Run**.
3. **Authentication → Users → Add user** : créez le compte des mariés (e-mail + mot de passe, cochez *Auto Confirm User*).
4. **Authentication → Sign In / Providers → Email** : **désactivez « Allow new users to sign up »** (sinon n'importe qui pourrait créer un compte).
5. **Project Settings → API** : copiez *Project URL* et la clé **anon public**.

### b) Configuration
Dans `docs/js/config.js` :
```js
SUPABASE_URL: 'https://xxxx.supabase.co',
SUPABASE_ANON_KEY: 'eyJ…',          // clé anon public, JAMAIS service_role
```

### c) GitHub Pages
Poussez le projet sur GitHub, puis **Settings → Pages → Deploy from a branch → `main` / dossier `/docs`**.
- Invitation : `https://<compte>.github.io/<depot>/?i=<jeton>`
- Back-office : `https://<compte>.github.io/<depot>/admin/`

À la **première connexion**, l'événement est créé avec les informations actuelles (dates, lieux, textes, boissons). Les mariés ajustent tout dans **Réglages**.

## 3. Utilisation (côté mariés)

| Onglet | À quoi ça sert |
|---|---|
| **Accueil** | Compte à rebours, présents / absents / en attente, personnes attendues, à-faire (invitations non envoyées, relances), boissons populaires, derniers vœux |
| **Invités** | Recherche, filtres (présents, absents, à relancer, non envoyés), création/modification, saisie manuelle d'une réponse, import par collage, export CSV |
| **Boissons** | Par boisson (qui a choisi quoi, combien de personnes) et par invité |
| **Livre d'or** | Tous les messages, filtrables présents/absents, copie en un tap |
| **Réglages** | Prénoms, cérémonies et lieux, textes, date limite, nombre de boissons, modèle du message d'envoi, catalogue de boissons |

**Champs d'une invitation** : civilité, nom, téléphone/WhatsApp, e-mail, catégorie, côté (marié/mariée/les deux), table, places réservées, cérémonies auxquelles l'invité est convié (civil / bénédiction / réception — la page de l'invité n'affiche que celles-ci), mot personnel visible par l'invité, notes privées, et réponse manuelle.

**Partage** : après la création, la feuille de partage s'ouvre (WhatsApp direct sur le numéro de l'invité, SMS, e-mail, menu de partage du téléphone, copie du lien, QR code). Depuis l'accueil, « Envoyer » enchaîne les invités non encore envoyés un par un.

Le bouton « retour » du téléphone ferme les feuilles ouvertes. Sur mobile, le back-office peut être ajouté à l'écran d'accueil (c'est une PWA).

## 4. Sécurité — ce qu'il faut savoir

- Les tables ne sont lisibles/modifiables que par le compte des mariés (RLS). Les invités passent uniquement par deux fonctions (`get_invitation`, `submit_rsvp`) qui n'exposent ni téléphone, ni e-mail, ni notes privées, et revalident tout côté serveur (places, nombre de boissons, statut).
- **Le lien personnel est le secret** (jeton aléatoire de 12 caractères). Quiconque l'a peut répondre à la place de l'invité : ne le publiez pas.
- La clé `anon` est publique par conception ; la protection vient des règles RLS.
- Supabase (offre gratuite) met un projet en pause après ~1 semaine sans activité : ouvrez le back-office avant les envois, ou passez en offre payante pour le jour J.
- GitHub Pages sert le site publiquement ; ne mettez aucun secret dans `docs/`.

## 5. Personnalisation

- **Images** : `docs/assets/images/` (photo d'en-tête `madisa.jpg`, cadre, fond des boissons, livre d'or).
- **Indicatif téléphonique** : `DEFAULT_COUNTRY_CODE` dans `config.js` (243 par défaut).
- **Domaine personnalisé** : renseignez `SITE_URL` dans `config.js`.
- **Aperçu WhatsApp avec photo** : décommentez `og:image` dans `docs/index.html` avec l'URL absolue de l'image.
- **Styles Tailwind** : le CSS compilé est fourni (`docs/css/tailwind.css`). Si vous ajoutez des classes Tailwind : `npm install && npm run build:css`.
