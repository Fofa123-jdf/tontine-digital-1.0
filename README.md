# Tontine Digital 1.0 — package corrigé

## Structure obligatoire dans GitHub

```text
package.json
server.js
schema.sql
render.yaml
public/
  member/index.html
  admin/index.html
```

Ne téléversez pas le ZIP comme seul fichier du dépôt. Décompressez-le et téléversez **son contenu** à la racine du dépôt.

## Déploiement Render
- Runtime : Node
- Build : `npm install`
- Start : `npm start`

Render déploie les commits de la branche liée automatiquement. Le serveur écoute sur `0.0.0.0` et utilise `PORT` fourni par Render.

## Base de données
Le serveur exécute `schema.sql` au démarrage pour créer les tables manquantes. Cette automatisation est destinée à cette version de test ; avant production, utiliser un système de migrations contrôlé.

## Premier administrateur
Configurer côté serveur :
- `ADMIN_BOOTSTRAP_EMAIL`
- `ADMIN_BOOTSTRAP_PASSWORD`
- `ADMIN_BOOTSTRAP_NAME`
- `ADMIN_BOOTSTRAP_PHONE`

Le premier démarrage crée un `super_admin` si l’adresse n’existe pas.

## Règle de commission
Première cotisation seulement :
- 1 % administration ;
- 1 % parrain valide ;
- commissions ajoutées au montant dû ;
- cotisations suivantes : 0 %.

Exemple : 500 FCFA + 5 FCFA + 5 FCFA = 510 FCFA.

## Important
Les interfaces et le paiement sont préparés pour les tests. Les vraies intégrations Orange Money, MTN Money, Wave, SMS/voix, webhooks signés et comptes marchands doivent être configurées avant toute utilisation avec de l'argent réel. Ne jamais placer de clés secrètes dans GitHub ou dans l'application membre.
