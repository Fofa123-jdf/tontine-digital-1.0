# Tontine Digital 1.0 — Interface fidèle à la maquette

Cette version reprend la disposition visuelle de la maquette fournie :
- Application membre : **12 écrans numérotés** (accueil, connexion, inscription, tableau de bord, tontine, cotisations, paiement, reçu, profil, notifications, parrainage, échanges/aide).
- Chaque écran possède son icône et ses accès.
- Espace administration séparé : tableau de bord + écrans Utilisateurs, Tontines, Paiements, Commissions, Rapports, Paramètres, Journal & Audit.
- L'image `reference.png` fournie est utilisée comme référence visuelle/illustration.

Règle de commission appliquée dans la démo :
- Première cotisation : 1% administration + 1% parrain valide = 2% maximum.
- Cotisations suivantes : 0%.

La validation d'inscription a été simplifiée et corrigée : les documents sont facultatifs dans cette démo afin que le bouton de validation ne bloque pas le test. En production, les documents et paiements devront être traités par un vrai backend sécurisé.

Identifiants de test membre : 0700000000 / 1234.

## Navigation séquentielle
L'application membre est maintenant présentée **écran par écran, dans l'ordre**, avec les boutons « Précédent » et « Suivant » et un indicateur de progression.
Les 12 écrans sont :
1 Accueil → 2 Connexion → 3 Inscription → 4 Tableau de bord → 5 Ma tontine → 6 Cotisations → 7 Paiement → 8 Reçu → 9 Profil → 10 Notifications → 11 Parrainage → 12 Échanges/Aide.


Navigation admin séquentielle : 1 Tableau de bord → 2 Utilisateurs → 3 Tontines → 4 Paiements → 5 Commissions → 6 Rapports → 7 Paramètres → 8 Journal & Audit. Boutons Précédent/Suivant et indicateur de progression.
