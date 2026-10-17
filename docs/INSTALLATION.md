# Installer et déployer PokeDraft

PokeDraft est une application Next.js déployable sur Vercel. Supabase fournit l’authentification anonyme, PostgreSQL et Realtime. Les mises, le tirage, les budgets et les attributions passent par des fonctions SQL transactionnelles.

## 1. Créer le projet Supabase

1. Créez un projet dans [Supabase](https://supabase.com/dashboard).
2. Dans **Authentication → Sign In / Providers**, activez **Anonymous Sign-Ins**. Ce mode donne à chaque navigateur une identité persistante sans demander d’adresse e-mail. Elle reste attachée à cet appareil et ne peut pas être récupérée après effacement des données du navigateur.
3. Ouvrez **SQL Editor**, copiez puis exécutez le contenu de [`supabase/migrations/202610170001_pokedraft.sql`](../supabase/migrations/202610170001_pokedraft.sql).
4. Vérifiez dans **Database → Publications** que les tables `rooms`, `room_players` et `public_bids` sont dans `supabase_realtime`. La migration tente de les y ajouter.
5. Dans les réglages **Realtime**, désactivez l’accès public aux canaux afin d’appliquer les politiques du canal privé de présence. Les politiques de la migration n’autorisent cette présence qu’aux deux membres du salon.
6. Dans **Project Settings → API**, copiez l’URL du projet et la clé publique (Publishable key; l’ancienne clé `anon` fonctionne aussi).

Les clients anonymes reçoivent le rôle `authenticated`. Les tables de jeu ont RLS activé; aucune écriture directe n’est accordée au navigateur. Les RPC vérifient l’identité et l’appartenance au salon. La table `secret_bids` ne permet de lire que sa propre ligne. Realtime utilise des changements de tables protégés par RLS et une présence privée, limitée aux membres.

## 2. Lancer en local

Installez Node.js 20.9 ou plus récent, puis :

```bash
npm install
cp .env.example .env.local
```

Renseignez dans `.env.local` :

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://votre-projet.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=votre-cle-publique-supabase
```

Sous PowerShell, copiez `.env.example` vers `.env.local` avec `Copy-Item .env.example .env.local`. Puis lancez `npm run dev` et ouvrez `http://localhost:3000`.

**N’ajoutez jamais de clé `service_role` ou de clé secrète dans une variable `NEXT_PUBLIC_*`.** Ce projet n’en a pas besoin.

## 3. Déployer sur Vercel

1. Poussez ce dossier dans un dépôt GitHub.
2. Dans Vercel, choisissez **Add New → Project**, importez le dépôt et gardez les réglages Next.js proposés.
3. Ajoutez `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY` dans **Environment Variables** pour Production et Preview.
4. Déployez. Les prochains commits seront déployés automatiquement.
5. Ouvrez l’URL de production sur deux appareils/réseaux différents. Créez un salon sur le premier, partagez le lien, puis rejoignez-le sur l’autre.

Le site n’est pas déployé par les fichiers seuls; il ne sera accessible qu’après ces étapes.

## Règles implémentées

- Chaque salon comporte au plus deux joueurs, 10 000 P$ par joueur et 12 lots.
- Le pool par défaut comprend les 88 espèces introduites en 7G et les 18 formes d’Alola de première génération. La migration stocke identifiant, nom, type, forme et URL du sprite. Les formulaires d’Alola ont des identifiants uniques dans le pool, ce qui permet une forme distincte de son espèce standard.
- Le périmètre est configurable en modifiant `eligible` et `scope` dans `pokemon_catalog`. Le tirage aléatoire de 12 identifiants distincts et l’ordre restent dans les tables privées; le navigateur reçoit uniquement le lot actuel.
- En mode à tour de rôle, le joueur d’ouverture alterne selon le siège et le numéro du lot. La mise initiale est de 500 P$, la surenchère minimale de 100 P$. Une passe ferme le lot; le dernier enchérisseur gagne. Si personne n’a misé, personne ne gagne. À expiration du délai, le dernier enchérisseur gagne; sinon le lot est sans gagnant.
- En mode secret, chacun dépose une mise unique entre 500 P$ et son budget, ou 0 pour passer. À l’échéance, une absence vaut forfait. La meilleure mise paie son montant; une égalité positive est départagée en faveur du joueur d’ouverture, dont le rôle alterne à chaque lot. Deux forfaits ne donnent aucun gagnant.
- Le compte à rebours affiché est indicatif. Quand il arrive à zéro, le client demande la clôture, mais la base vérifie l’heure serveur. À la reconnexion, l’état courant est récupéré et un lot expiré est clôturé.
- Une mise publique possède un identifiant de requête idempotent. Une attribution, le débit et le passage au lot suivant sont réalisés dans une transaction PostgreSQL. Les appels répétés ne peuvent pas attribuer ou débiter deux fois.
- Quitter une salle d’attente libère la place; quitter une partie active la marque interrompue. Une salle d’attente est considérée expirée après 24 heures et son démarrage ou sa jonction sont refusés. Les salons actifs ne sont pas expirés automatiquement afin de permettre une reconnexion.

## Export Showdown et limites

Le format visé est **Gen 7 OU**. L’export donne les espèces sélectionnées, sans inventer d’attaques, d’objets, de talents ou d’EV. La légalité d’équipe n’est pas calculée par l’application; vérifiez les Pokémon choisis dans le constructeur d’équipe Showdown pour le format retenu. Les formes de génération VII sont signalées distinctement dans le catalogue.

Les sprites sont servis depuis les ressources publiques PokeAPI sur GitHub; les données de sélection et les types sont stockés dans Supabase afin qu’aucun appel PokeAPI ne soit nécessaire pendant une enchère. La connexion Internet reste nécessaire au chargement des sprites.

L’offre gratuite Vercel Hobby est destinée aux projets personnels et a des quotas de déploiement, de bande passante et d’exécution. Le plan Supabase Free inclut actuellement 500 Mo de base de données, 50 000 utilisateurs actifs mensuels et 2 millions de messages Realtime; les projets peu actifs peuvent être mis en pause après une semaine. Les quotas changent : vérifiez les pages de [tarification Vercel](https://vercel.com/pricing), [limites Vercel](https://vercel.com/docs/limits), [tarification Supabase](https://supabase.com/pricing) et [mise en pause Supabase](https://supabase.com/docs/guides/platform/free-project-pausing) avant un lancement public.

L’authentification anonyme limite la continuité de compte à l’appareil. Pour un site public, ajoutez une protection CAPTCHA / Turnstile selon le guide Supabase et une authentification liée (e-mail ou OAuth) avant d’utiliser ce prototype comme service durable.
