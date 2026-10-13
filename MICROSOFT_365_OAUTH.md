# Connexion Microsoft 365 — GCV-UFB

L’application envoie les e-mails avec Microsoft Graph et une **autorisation OAuth déléguée**. Le mot de passe de la boîte `gcv.ufb@adventiste.org` n’est ni demandé ni stocké. Le titulaire autorise l’application dans la page officielle Microsoft. La permission est limitée à `Mail.Send` pour l’utilisateur connecté; `User.Read` sert uniquement à vérifier la boîte, et `offline_access` renouvelle les jetons sans connexion répétée.

## Préparer Microsoft Entra

1. Dans le [Centre d’administration Microsoft Entra](https://entra.microsoft.com/), ouvrez **Identité > Applications > Inscriptions d’applications > Nouvelle inscription**.
2. Nommez l’application, par exemple `GCV-UFB Agenda des invitations`, et choisissez **Comptes dans cet annuaire organisationnel uniquement** (application mono-locataire).
3. Dans **Authentification**, ajoutez une plateforme **Web** et l’URI de redirection affichée dans les réglages de l’application GCV-UFB. Elle correspond au callback API `/api/microsoft/callback`; copiez-la exactement, sans slash supplémentaire. Pour l’environnement publié, l’origine publique HTTPS `PUBLIC_APP_URL` doit être configurée côté serveur afin que l’application affiche l’URI exacte.
4. Dans **Autorisations API > Ajouter une autorisation > Microsoft Graph > Autorisations déléguées**, ajoutez `Mail.Send` et `User.Read`. `openid`, `profile`, `email` et `offline_access` sont des étendues d’identité standard envoyées lors de l’autorisation OAuth.
5. Dans **Certificats et secrets**, créez un secret client. Copiez sa **valeur** immédiatement, car Microsoft ne l’affiche qu’à sa création. C’est le secret de l’inscription de l’application — **pas** le mot de passe Microsoft 365 de la boîte.
6. Si le tenant désactive le consentement utilisateur, demandez à l’administrateur du tenant d’approuver le consentement délégué `Mail.Send` et `User.Read` pour cette inscription.

## Fournir les identifiants à GCV-UFB

À l’aide de la carte protégée Manus, enregistrez les variables côté serveur :

- `MS_GRAPH_CLIENT_ID` — ID d’application (client) de l’inscription Entra.
- `MS_GRAPH_TENANT_ID` — ID de l’annuaire (tenant/directory), de préférence son GUID.
- `MS_GRAPH_CLIENT_SECRET` — valeur du secret client de l’inscription, jamais le mot de passe de la boîte.
- `PUBLIC_APP_URL` — origine HTTPS publique du site publié, sans slash final; nécessaire pour construire le callback et les liens d’action des e-mails. L’API utilise la même origine; si elle a un domaine distinct, configurez également `PUBLIC_API_URL`.

Ne mettez ni les identifiants Entra, ni le secret client dans le code, l’application native, le chat ou un dépôt Git. Configurez ces variables côté serveur dans l’environnement de production. Configurez aussi `PUBLIC_APP_URL` avec l’origine du site publié. Pour un build natif, définissez `EXPO_PUBLIC_API_BASE_URL` à l’origine API avant la compilation; ce n’est pas un secret. Après configuration, ouvrez **Espace administrateur > Réglages > Connecter Microsoft 365** et connectez le compte professionnel `gcv.ufb@adventiste.org` sur `login.microsoftonline.com`.

## Sécurité et comportement

- OAuth Authorization Code avec `state` aléatoire à usage unique et PKCE-S256.
- Le callback vérifie que l’utilisateur Microsoft est bien `gcv.ufb@adventiste.org` avant d’enregistrer une connexion.
- Le serveur ne garde pas de mot de passe Microsoft 365 ni de jeton d’accès. Il chiffre le jeton de renouvellement avec AES-256-GCM dans la base et remplace le jeton lorsqu’il est renouvelé.
- Graph `POST /me/sendMail` utilise la boîte autorisée comme expéditeur, `gcv.ufb@adventiste.org` comme Reply-To et place les messages envoyés dans **Éléments envoyés**.
- Sans inscription, secrets ou consentement, l’outbox reste en preview; elle ne prétend pas qu’un e-mail a été envoyé.
- Faire tourner le secret client de l’inscription sans reconnecter la boîte empêchera de déchiffrer le jeton stocké; après une rotation, déconnectez puis réautorisez la boîte.
- Déconnecter dans GCV-UFB efface le jeton stocké par cette application. Le consentement Entra se révoque séparément dans **Applications d’entreprise** du tenant si nécessaire.

## Sources Microsoft

- [Flux OAuth 2.0 authorization code avec accès délégué](https://learn.microsoft.com/graph/auth-v2-user)
- [API Microsoft Graph `sendMail`](https://learn.microsoft.com/graph/api/user-sendmail?view=graph-rest-1.0)
- [Inscrire une application Microsoft Entra](https://learn.microsoft.com/entra/identity-platform/quickstart-register-app)
- [Référence des permissions Microsoft Graph](https://learn.microsoft.com/graph/permissions-reference)
