# GCV-UFB — Agenda des invitations de prédication

Application Expo/React Native en français, conçue pour smartphone, navigateur, tablette et ordinateur. Elle remplace la gestion dispersée des demandes et disponibilités par une agenda transactionnel et un espace administrateur.

## Utiliser l’application

- Page publique : `/`
- Demande d’invitation : `/request`
- Administration : `/admin` (connexion Manus obligatoire; l’adresse principale autorisée est `gcv.ufb@adventiste.org`)
- Réglages et connexion Microsoft 365 : `/admin/settings`
- Confidentialité et droits RGPD : `/privacy`, `/data-rights`

Une date n’est réservable que lorsqu’elle est `AVAILABLE`. La création d’une demande revendique la date dans une transaction et la fait passer à `PENDING_CONFIRMATION`; une seule demande concurrente peut réussir. La décision de l’administration la confirme ou la libère. Tant que Microsoft Graph n’est pas connecté et que les notifications ne peuvent pas être délivrées, le formulaire public demeure en lecture seule et n’accepte pas de demande silencieuse.

## Architecture et données

- **Client :** Expo Router, React Native, TypeScript et NativeWind; le même projet produit l’application native et l’interface Web.
- **Frontend Web :** export Expo précompilé vers `dist/web`, publié par WebDev dans son stockage statique; les chemins `/` et les routes Expo sont servis par le fallback SPA.
- **API :** Express + tRPC dans un container Node 22, sous `/api/*`; le routage WebDev envoie les API au serveur et les pages/actifs au frontend statique. Les deux partagent la même origine publique.
- **Persistance :** MySQL géré, schéma Drizzle dans `drizzle/schema.ts` et migrations versionnées dans `drizzle/`.
- **Authentification :** Manus OAuth; chaque API admin vérifie côté serveur la session, le profil actif, le rôle et l’adresse autorisée.
- **E-mail :** Microsoft Graph v1.0, OAuth 2.0 Authorization Code + PKCE et permission déléguée `Mail.Send`. Aucun mot de passe de boîte aux lettres n’est demandé ou stocké. Les jetons de renouvellement sont chiffrés AES-256-GCM dans la base; l’envoi et les tentatives sont suivis dans l’outbox. Adresse d’expédition/réponse attendue : `gcv.ufb@adventiste.org`.
- **Cache :** les bundles Expo versionnés utilisent un cache long; HTML, JSON de routes et réponses admin/API restent non cacheables/privés.

Tables principales : `date_slots`, `invitation_requests`, `admin_profiles`, `audit_log`, `app_settings`, `email_outbox`, `action_tokens`, `microsoft_oauth_states`, `microsoft_mail_connections`, `privacy_requests`, `reminder_log` et `scheduled_jobs`.

## Développement et commandes

Environnement initialisé : projet Manus WebDev **GCV-UFB — Agenda des invitations** (dossier du projet `gcvagenda`). Le starter utilise Expo/Metro sur le port `8081` et l’API sur `3000`.

```bash
pnpm install
pnpm dev                 # Preview Expo Web + API
pnpm check               # TypeScript
pnpm lint                # ESLint/Expo
pnpm test                # Tests Vitest
pnpm tsx scripts/verify-gcv.ts  # Scénarios métier avec fixtures temporaires
pnpm db:push             # Générer/appliquer les migrations Drizzle
```

Le container API utilise le `Dockerfile` à la racine et exécute `pnpm@9.12.0` via `npm exec --yes --package=pnpm@9.12.0 -- pnpm build`. Le frontend statique a son propre contrat WebDev : `npm exec --yes --package=pnpm@9.12.0 -- sh -eu -c 'pnpm install --frozen-lockfile && EXPO_PUBLIC_API_BASE_URL="${PUBLIC_API_URL:-}" pnpm build:web'`; le dossier déclaré en sortie est `dist/web`. Le pipeline utilise le cache npm, sans installation globale ni Corepack.

## Connexion Microsoft 365

Suivre **[MICROSOFT_365_OAUTH.md](./MICROSOFT_365_OAUTH.md)**. Le propriétaire du tenant doit inscrire une application Web Microsoft Entra, déclarer l’URI de redirection exacte `https://<domaine-publié>/api/microsoft/callback`, accorder les permissions déléguées nécessaires (`Mail.Send`, `User.Read`, `offline_access`) et créer un secret d’application. Transmettre uniquement `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_TENANT_ID` et `MS_GRAPH_CLIENT_SECRET` par la saisie protégée WebDev; ne jamais les ajouter à `.env`, au code, au dépôt ou à un message.

Après configuration, un administrateur connecté ouvre **Réglages → Microsoft 365 → Connecter Microsoft 365**. Microsoft présente sa page officielle de connexion/consentement; sélectionner la boîte professionnelle `gcv.ufb@adventiste.org`. Le serveur vérifie l’identité retournée et refuse une autre boîte. L’application n’a accès qu’aux permissions déléguées demandées; elle ne collecte pas le mot de passe du compte.

Définir côté serveur `PUBLIC_APP_URL` comme origine HTTPS publique du projet pour afficher l’URI exacte, construire les liens d’action par e-mail et retourner de Microsoft vers le tableau de bord. Si le domaine de l’API est distinct, définir aussi `PUBLIC_API_URL`. Pour compiler une application native, fournir `EXPO_PUBLIC_API_BASE_URL` avec l’origine API avant le build natif; la version Web publiée utilise des chemins relatifs de même origine.

## Gérer l’agenda et modifier le contenu

- **Dates :** dans Administration → Agenda, ajouter une date ou générer des samedis entre deux bornes; filtrer par mois, statut et fédération. Une date sans réservation peut être bloquée/libérée/supprimée. Une date avec historique n’est pas supprimée : annuler une invitation confirmée et choisir « libérer » ou « bloquer » l’ancienne date.
- **Demandes :** Administration → Demandes permet recherche, filtres, détails, modification, confirmation, refus/libération, annulation et déplacement. Les transitions importantes sont auditées.
- **Fédérations et champs :** Réglages permet d’ajouter/supprimer des fédérations et de masquer/rendre obligatoires les quatre champs optionnels.
- **Textes et e-mails :** les modèles peuvent être modifiés dans Réglages. Placeholders disponibles : `{{prenom}}`, `{{date}}`, `{{eglise}}`, `{{federation}}`, `{{contact}}`, `{{email}}`, `{{telephone}}`, `{{type}}`, `{{heure}}`, `{{adresse}}`, `{{message}}`, `{{identifiant}}`, `{{lien_agenda}}`. Les contrôles de décision et l’adresse de réponse restent gérés par le système.
- **Logo :** remplacer les assets correspondants dans `assets/images/` (icône, splash, icônes adaptatives et favicon). Le `logoUrl` documenté dans `app.config.ts` sert aux métadonnées WebDev; conserver une URL HTTPS accessible.
- **Couleurs :** modifier la palette `GCV` et les couleurs de statut dans `components/gcv-ui.tsx` et `shared/gcv.ts`; vérifier les contrastes et les variantes claire/foncée avant de reconstruire. L’interface conserve la direction institutionnelle bleu, blanc et gris clair.
- **Statistiques/exports :** le tableau de bord présente les disponibilités, demandes en attente, confirmations, prochaines interventions et statistiques. Réglages permet d’exporter les demandes par année, fédération et état en CSV ou XLSX.

## Rappels

Les préférences J-30/J-7/J-1 se règlent dans Administration → Réglages. Après la première publication, créer le job Manus Heartbeat quotidien et associer son `taskUid` à la base :

```bash
manus-heartbeat create --name gcv-ufb-reminders --cron "0 0 7 * * *" --path /api/scheduled/reminders --payload '{}' --description "Rappels quotidiens des invitations GCV-UFB"
pnpm tsx scripts/register-reminders.ts <taskUid-retourné>
```

Le cron est en UTC. Le traitement déduplique les rappels par invitation, date, échéance et destinataire. Le réglage peut désactiver les rappels sans supprimer l’automatisation. La rétention RGPD n’est pas lancée automatiquement : son exécution requiert une action explicite dans le panneau.

## Sauvegardes, coûts et publication

- L’export **CSV/XLSX** dans Réglages permet de sauvegarder les invitations et l’historique selon l’année, la fédération et le statut. Télécharger et conserver les exports dans un emplacement organisationnel contrôlé, chiffré et à accès limité.
- Pour une sauvegarde complète (structure et données, y compris réglages/audit), utiliser la fonction de sauvegarde de la base gérée du projet WebDev ou effectuer un dump MySQL à partir d’un environnement autorisé; les fichiers locaux du container ne sont pas une sauvegarde persistante.
- Le serveur de production est éphémère : ne pas y conserver de fichiers métier. Les données persistantes sont dans MySQL; enregistrer les versions de code par checkpoint Manus WebDev.
- La cible initiale est l’hébergement géré WebDev et son MySQL. Les tarifs/quota dépendent de l’offre et du dimensionnement du projet; ne pas supposer qu’un niveau gratuit précis est garanti. Vérifier les quotas et coûts affichés dans le Dashboard avant une utilisation soutenue.
- Le lien d’aperçu n’est pas une publication. Publier depuis le Dashboard WebDev après le checkpoint accepté, puis transmettre le lien public confirmé.

## Sécurité et confidentialité

L’API authentifie les administrateurs à chaque requête et vérifie un profil actif, son rôle et l’adresse du compte. Les lectures privées et les mutations portent des réponses `no-store`. Les formulaires exigent un consentement explicite. Les demandes d’accès/effacement passent par le panneau de confidentialité; l’exécution de la rétention anonymise les demandes terminées au-delà de la durée choisie, sans toucher aux demandes en attente ou aux interventions futures.
