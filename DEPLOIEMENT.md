# Déploiement

1. PostgreSQL : créer la base puis exécuter `api/db/schema.sql`.
2. API : `cd api && npm install && npm start` avec `.env` configuré.
3. Créer le premier administrateur à partir d'un outil d'administration sécurisé ou d'un script de bootstrap avant ouverture publique; ne pas mettre ses identifiants dans Git.
4. Servir `member/` sur `app.domaine.tld`, `admin/` sur `admin.domaine.tld`, API sur `api.domaine.tld`.
5. Mettre HTTPS, CORS strict, sauvegardes PostgreSQL et secrets serveur.
6. Configurer Wave/Orange/MTN et leurs webhooks seulement après validation contractuelle et tests.
