# Tontine Digital 1.0 — package corrigé

## Structure
```text
package.json
server.js
schema.sql
render.yaml
.env.example
README.md
public/
  index.html
  member/
    index.html
  admin/
    index.html
```

**Important :** GitHub ne décompresse pas automatiquement un ZIP. Décompressez ce package puis envoyez les fichiers/dossiers à la racine du dépôt.

## Fonctionnel dans cette version
- application membre séparée de l'administration ;
- authentification JWT avec rôles `member`, `admin`, `super_admin` ;
- inscription, connexion, code parrain ;
- création et adhésion aux tontines ;
- calcul de la première cotisation : 1 % administration + 1 % parrain valide, commissions ajoutées au total ;
- 0 % de commission sur les cotisations suivantes ;
- paiement en mode test/manuellement confirmable ;
- idempotence et blocage des doubles paiements en attente ;
- référence prestataire unique ;
- grand livre `TONTINE_FUNDS`, `ADMIN_COMMISSION`, `SPONSOR_COMMISSION`, `REFUND` ;
- comptes de collecte ;
- ordres de paiement bénéficiaire ;
- audit ;
- PostgreSQL ;
- déploiement Render.

## Règle financière
Pour une première cotisation de 500 FCFA avec parrain valide :
- cotisation : 500 FCFA ;
- commission administration : 5 FCFA ;
- commission parrain : 5 FCFA ;
- total payé : **510 FCFA**.

Les cotisations suivantes ne comportent aucune commission.

## Démarrage local
1. `npm install`
2. créer `.env` à partir de `.env.example`
3. renseigner `DATABASE_URL` et `JWT_SECRET`
4. renseigner `ADMIN_BOOTSTRAP_EMAIL` et `ADMIN_BOOTSTRAP_PASSWORD`
5. `npm start`
6. ouvrir `/member/` ou `/admin/`

## Render
Le `render.yaml` est prévu pour un service Node + PostgreSQL. Les secrets sont à renseigner dans Render. Après un push sur `main`, le service configuré en auto-déploiement redéploie le code.

## Limite importante
Le package est complet pour le **test fonctionnel**, mais il ne peut pas inventer les accès marchands. Les intégrations réelles Wave/Orange Money/MTN/Moov, les signatures officielles de webhook et les SMS/voix nécessitent les comptes, clés API et spécifications des prestataires. Tant qu'ils ne sont pas configurés, utilisez le mode de paiement manuel/test.

Ne mettez jamais de clés API, mots de passe ou secrets dans GitHub.
