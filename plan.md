# Plan du pilote Agenda UFB

Ce chantier étend l’agenda aux départements de l’Union Franco-Belge. Les anciennes instructions de déploiement Manus/Microsoft ne décrivent plus l’application actuelle. Les choix opérationnels sont documentés dans README.md et DEPLOY_FREE.md.

## Réalisé dans le code

- Choix département/fédération/intervention et réservation transactionnelle.
- Comptes individuels et périmètres de lecture/écriture par département.
- Agenda et demandes filtrés, plusieurs disponibilités par jour et exports avec département.
- Gestion des types d’intervention sans suppression de l’historique.
- Compte Gmail d’envoi partagé pour le pilote, autorisation et jetons séparés de l’ancienne GCV.
- Protection des sessions, construction Web/API et tests sans données réelles.

## Avant acceptation

- Publier dans le nouveau dépôt privé et le nouveau service Render autorisés.
- Vérifier la base dédiée UFB et réaliser les tests MySQL dans une base de test distincte.
- Configurer le client Google, puis faire autoriser le compte par son propriétaire.
- Configurer les types d’intervention et les disponibilités représentatives du pilote.
- Valider une demande, ses décisions et les e-mails réels.
- Choisir et vérifier l’exécution des rappels sans créer de facturation non autorisée.
- Faire accepter le pilote par l’utilisateur.

L’ancienne Agenda GCV, son dépôt, sa base et son service restent en dehors du périmètre des modifications.
