# Plan d’implémentation — GCV-UFB Agenda des invitations

Ce document restaure le plan approuvé dans le contexte de reprise. Il décrit les choix déjà réalisés pour cette application; il ne modifie pas le périmètre produit.

## Objectif

Remplacer le flux manuel Tally/Sheets de gestion des invitations de prédication GCV-UFB par une application institutionnelle en français, utilisable sur navigateur, tablette et téléphone, avec persistance sûre, décisions administratives traçables et e-mails via Microsoft 365.

## Critères d’acceptation

- Identité visuelle institutionnelle bleu, blanc et gris; interface et textes en français.
- Formulaire public de demande et agenda administrateur permettant le cycle complet d’une invitation: confirmer, refuser/libérer, annuler et reprogrammer.
- Intégrité transactionnelle: une même date ne peut pas être réservée par deux demandes concurrentes.
- Envoi depuis `gcv.ufb@adventiste.org` avec Microsoft Graph et OAuth 2.0 délégué/PKCE; le mot de passe principal Microsoft 365 ne doit jamais être demandé ou stocké. La page officielle Microsoft doit servir à autoriser le compte; l’adresse d’expédition et de réponse est celle de GCV-UFB.
- Accès administrateur protégé, statistiques, historique d’audit et gestion des droits RGPD (accès et suppression/anonymisation).
- Rappels automatisés à J-30, J-7 et J-1, exécutés par un heartbeat quotidien et dédupliqués de manière idempotente.
- Export des données filtrées en CSV et XLSX.
- Liens simples Confirmer/Refuser dans les e-mails administratifs, limités dans le temps et à usage sécurisé.

## Architecture retenue

- **Client:** Expo Router, React Native, TypeScript et NativeWind, partageant les vues entre Web et application mobile.
- **Frontend Web:** export statique Expo dans `dist/web`, publié dans le stockage statique WebDev. Les routes d’interface ont un fallback SPA; les bundles hachés sont immuables.
- **API:** Express + tRPC sur Node 22 dans un container WebDev, API sous `/api/*`; frontend et API partagent l’origine publiée.
- **Données:** MySQL géré par WebDev, schéma Drizzle et migrations versionnées.
- **E-mail:** Microsoft Graph v1.0 avec Authorization Code + PKCE et permission déléguée `Mail.Send`; aucun mot de passe de boîte. Les jetons de renouvellement sont chiffrés AES-256-GCM en base.
- **Déploiement hybride:** build statique (`dist/web`) et serveur (`Dockerfile`, port fourni par plateforme, `/api/health`), avec chemins `/api/*` vers le serveur, `/manus-routes.json` statique sans cache, `/_expo/static/*` statique immuable et `/*` statique avec fallback SPA.

## Flux principaux

1. Le visiteur consulte les disponibilités et soumet une demande avec consentement explicite.
2. Une transaction revendique atomiquement le créneau; les états et changements importants sont enregistrés et auditables.
3. L’administration connectée examine les demandes, prend une décision ou reprogramme; des liens d’action sécurisés peuvent confirmer ou libérer une demande.
4. La confidentialité permet l’accès et le traitement d’effacement/anonymisation, sans effacer automatiquement les demandes en attente ni les interventions futures.
5. Le heartbeat quotidien appelle `/api/scheduled/reminders`. Les rappels sont ciblés à J-30/J-7/J-1 et la clé métier (invitation, date, échéance, destinataire) rend les reprises sans doublons.

## Sécurité et configuration requise

Les API d’administration vérifient la session, le profil actif, le rôle et l’adresse autorisée. Les réponses privées ne sont pas mises en cache. Les clés d’application Microsoft Entra et l’origine HTTPS publique doivent être fournies dans les secrets protégés WebDev après publication. L’utilisateur doit ensuite autoriser `gcv.ufb@adventiste.org` depuis les réglages via la page officielle Microsoft. Tant que cette configuration n’est pas terminée, le formulaire ne doit pas accepter silencieusement de nouvelles demandes.

## Vérification et release

- Diagnostics TypeScript, lint Expo et tests automatiques existants.
- Scénarios métier transactionnels existants dans `scripts/verify-gcv.ts`.
- Export réel Expo Web dans `dist/web` et contrôle des routes exportées.
- Intégration de `origin/main`, commit et push du checkpoint canonique `main`.
- Publication explicite WebDev; après succès, vérifier l’URL publique, l’API de santé, la page d’accueil et les routes d’entrée directe.
- Créer ou réutiliser le heartbeat quotidien à 07:00 UTC et enregistrer son `taskUid` dans `scheduled_jobs`.
