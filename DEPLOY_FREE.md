# Agenda UFB — Déploiement pilote gratuit

## Projet indépendant

- Dépôt GitHub : https://github.com/GCV-UFB/Agenda-UFB
- Branche : main
- Service Render : nouveau service Web, indépendant de la GCV.
- Base de données : base dédiée `agenda_ufb`.

L'application Agenda GCV existante, son dépôt GitHub,
son service Render et sa base de données ne doivent
jamais être modifiés par ce déploiement.

## Configuration du pilote

Créer un nouveau service Web sur Render en utilisant
le dépôt Agenda-UFB.

Choisir une formule gratuite si elle est disponible.
Ne sélectionner aucune formule payante sans autorisation.

Utiliser le Dockerfile du projet.

Configurer les variables d'environnement nécessaires
dans Render, sans publier leurs valeurs dans GitHub.

Variables principales :

- DATABASE_URL : connexion à la base UFB dédiée.
- JWT_SECRET : secret propre à Agenda UFB.
- UFB_EMAIL_NOTIFICATIONS_ENABLED=false

Ne pas configurer Gmail pour le pilote.

Les notifications par e-mail doivent rester désactivées
pendant toute la démonstration.

## Sécurité

Ne jamais publier :

- .env.local
- mots de passe
- secrets JWT
- identifiants de base de données
- jetons Google

Ne pas exécuter de migrations sur la base GCV.
Ne pas utiliser db:push pendant cette publication.

## Vérification

Avant publication :

1. Vérifier les fichiers suivis par Git.
2. Vérifier l'absence de secrets dans les modifications.
3. Confirmer le dépôt GitHub Agenda-UFB.
4. Vérifier les paramètres du nouveau service Render.

Après publication :

1. Ouvrir l'adresse HTTPS publique.
2. Vérifier la page d'accueil.
3. Tester les demandes avec des données fictives.
4. Vérifier les accès administratifs.
5. Confirmer qu'aucun e-mail n'est envoyé.

L'activation future des notifications nécessite
une validation administrative distincte.
