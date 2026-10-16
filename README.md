# Agenda UFB — invitations et interventions

Application Web en français pour les départements de l’Union Franco-Belge. Les visiteurs choisissent un département, une fédération, un type d’intervention et une disponibilité. Les administrateurs gèrent uniquement les départements autorisés; l’administrateur principal gère les comptes et les réglages.

## Démarrage local

Node et pnpm 9.12.0 sont nécessaires. Les commandes passent par Corepack pour utiliser la version déclarée dans le projet.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Le navigateur utilise `http://localhost:8081`; l’API locale utilise le port 3000. Copier `.env.example` vers `.env.local` uniquement si ce fichier n’existe pas déjà, puis saisir les secrets localement. Ne jamais écraser un fichier de configuration existant ni copier les identifiants de la base GCV ancienne.

## Fonctionnalités du pilote

- Formulaire public avec choix du département, de la fédération et du type d’intervention, récapitulatif et consentement.
- Réservation atomique d’une disponibilité; une demande concurrente ne doit pas prendre la même place.
- Agenda avec filtres département/fédération/statut; plusieurs disponibilités d’un même jour restent visibles et sélectionnables.
- Demandes avec recherche, confirmation, refus, modification, annulation et déplacement vers une date du même département et de la même fédération.
- Gestion des types d’intervention par département : ajout, renommage, désactivation et réactivation, sans supprimer l’historique.
- Comptes individuels `PRIMARY_ADMIN`, `ADMIN` et `READ_ONLY`; contrôles de droits côté serveur.
- Notifications à la boîte centrale et aux administrateurs actifs des départements concernés. Les lecteurs seuls ne reçoivent pas les liens de décision.
- Exports CSV/XLSX filtrés avec le nom du département; journal d’audit et traitement des demandes de confidentialité.
- Rappels J-30/J-7/J-1 dédupliqués. Leur automatisation doit être configurée séparément après publication; elle n’est pas active par le seul fait d’activer le réglage.
- Synchronisation Google Calendar facultative; laisser `GOOGLE_CALENDAR_ID` vide pour la désactiver.

## E-mails du pilote

Le compte d’envoi convenu est `giovane.bono77@gmail.com`. La boîte administrative et de réponse reste `gcv.ufb@adventiste.org`. Ces adresses seront réexaminées après acceptation du pilote.

Le formulaire reste fermé à l’envoi tant que Google n’est pas configuré et qu’un jeton chiffré utilisable pour le bon compte n’est pas présent. Une erreur d’envoi après enregistrement n’efface pas la demande et ne doit pas provoquer une deuxième soumission.

Dans `/admin/settings`, l’administrateur principal voit l’adresse de retour Google et le bouton d’autorisation lorsque la configuration est complète. L’autorisation vérifie le compte Google réellement retourné et conserve un jeton propre à cette base UFB. Ne pas révoquer l’autorisation de l’ancienne Agenda GCV.

Les paramètres privés restent sur le serveur : `DATABASE_URL`, `JWT_SECRET` (32 caractères minimum), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY` (64 caractères hexadécimaux), `GMAIL_USER`, `PUBLIC_APP_URL`, `PUBLIC_API_URL`. `APP_ID` doit identifier ce pilote. Aucun mot de passe Gmail n’est demandé.

## Vérification

```sh
corepack pnpm check
corepack pnpm run lint
corepack pnpm run test --cache=false
corepack pnpm run build
corepack pnpm run pilot:check
```

Le rapport sans secrets est écrit dans `artifacts/pilot-report.json`. Il distingue la construction du code et les connexions externes encore manquantes. Les tests Vitest utilisent des données simulées et n’envoient pas d’e-mail.

Les scénarios transactionnels MySQL réels s’exécutent uniquement avec `UFB_TEST_DATABASE_URL`, vers une base distincte dont le nom indique `test` ou `verification`, après application du schéma dans cette base de test :

```sh
corepack pnpm exec tsx scripts/verify-gcv.ts
```

Sans cette configuration, le script s’arrête avant toute écriture. Il ne doit jamais être exécuté sur la base de la GCV ancienne ou du pilote en exploitation.

## Publication et isolation

Voir [DEPLOY_FREE.md](DEPLOY_FREE.md). Le Dockerfile produit le Web statique et l’API dans un service unique. `.dockerignore` exclut les secrets, le dossier Git et les copies de sauvegarde.

La copie locale UFB et `gcv_work` ont été trouvées avec le même dépôt distant. Ne pas pousser ce chantier vers ce dépôt avant séparation explicite. Le pilote doit utiliser son propre dépôt, son propre service, sa propre base, sa propre clé de session et sa propre clé de chiffrement Google. Les cookies et le stockage navigateur de cette application utilisent un espace de noms UFB distinct.

Avant ouverture aux utilisateurs : vérifier la publication HTTPS, les connexions administrateur, une demande et son cycle complet, les e-mails réels et le plan des rappels. Le build seul ne constitue pas une acceptation du pilote.
