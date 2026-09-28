# Tontine Digital 1.0 — Package de déploiement

Ce package regroupe :
- application membre ;
- espace administration ;
- API Node.js/Express ;
- schéma PostgreSQL ;
- configuration Render ;
- variables d'environnement d'exemple.

## Déploiement Render

Le service API utilise :
- Build : `npm install`
- Start : `npm start`
- Port : `PORT` (10000 par défaut)

La base PostgreSQL est prévue via `render.yaml`.

## Initialisation de la base

Le schéma est dans `schema.sql`. Sur Render, si vous utilisez le Blueprint, exécutez le schéma sur la base avant les tests.

## Premier administrateur

Renseigner dans les variables d'environnement Render :
`ADMIN_BOOTSTRAP_NAME`
`ADMIN_BOOTSTRAP_PHONE`
`ADMIN_BOOTSTRAP_EMAIL`
`ADMIN_BOOTSTRAP_PASSWORD`

Le serveur crée le premier `super_admin` s'il n'existe pas encore.

## Règle de commission

Première cotisation uniquement :
- 1 % administration ;
- 1 % parrain si un parrain valide existe ;
- les frais sont ajoutés au montant de la première cotisation.

Exemple : 500 FCFA + 5 FCFA + 5 FCFA = 510 FCFA.

Cotisations suivantes : aucune commission.

## Important

Les paiements Orange Money, MTN Money et Wave ne sont pas activés avec de vraies clés dans ce package. Les clés et webhooks doivent être ajoutés côté serveur avant toute utilisation financière réelle.
