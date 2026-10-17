# PokeDraft

Application web multijoueur d’enchères Pokémon, conçue pour être déployée sur Vercel avec Supabase.

## Démarrage

Consultez le [guide d’installation, configuration Supabase, variables d’environnement et déploiement Vercel](docs/INSTALLATION.md).

1. Créez un projet Supabase et activez les connexions anonymes.
2. Exécutez la migration [`supabase/migrations/202610170001_pokedraft.sql`](supabase/migrations/202610170001_pokedraft.sql).
3. Configurez les variables indiquées dans [`.env.example`](.env.example).
4. Importez le dépôt dans Vercel.

Le projet n’est pas en ligne tant qu’il n’a pas été déployé et vérifié dans Vercel.
