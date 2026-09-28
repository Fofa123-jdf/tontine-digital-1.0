# Tontine Digital 1.0 — Déploiement corrigé

## Structure actuelle
- `server.js` : API Node/Express
- `bootstrap-admin.js` : création sécurisée du premier super administrateur
- `schema.sql` : schéma PostgreSQL
- `index.html1` : interface administration
- `index.html2` : interface membre
- `.env.example` : variables d'environnement

## Installation API
```bash
npm install
npm start
```

Le script `start` lance directement `server.js` à la racine du dépôt.

## Base PostgreSQL
Créer la base puis exécuter :
```bash
psql "$DATABASE_URL" -f schema.sql
```

## Premier administrateur
Configurer temporairement dans l'environnement serveur :
- `ADMIN_BOOTSTRAP_EMAIL`
- `ADMIN_BOOTSTRAP_PASSWORD`

Puis exécuter :
```bash
npm run bootstrap-admin
```

Ne jamais mettre ces identifiants, ni une clé API réelle, dans GitHub.

## Frontends
Pour un hébergement statique, publier `index.html2` pour l'application membre et `index.html1` pour l'administration, avec `TD_API` configuré vers l'URL HTTPS de l'API.

## Production
Configurer HTTPS, PostgreSQL, CORS strict, `JWT_SECRET`, `PASSWORD_SALT`, les paramètres des prestataires de paiement et les webhooks avant toute utilisation réelle.
