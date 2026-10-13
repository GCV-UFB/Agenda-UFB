# Déploiement gratuit indépendant de Manus

Architecture retenue :
- Application/API : Render Web Service (Free)
- Base MySQL compatible : TiDB Cloud Starter (quota gratuit, limite de dépense à 0)
- E-mail : Microsoft Graph avec la boîte gcv.ufb@adventiste.org

Variables serveur requises :
- DATABASE_URL : URL MySQL/TLS TiDB
- JWT_SECRET : chaîne aléatoire longue (32+ octets)
- ADMIN_PASSWORD : mot de passe administrateur fort (12+ caractères)
- APP_ID : gcv-ufb-agenda
- PUBLIC_APP_URL : https://<service>.onrender.com
- PUBLIC_API_URL : identique à PUBLIC_APP_URL
- MS_GRAPH_CLIENT_ID
- MS_GRAPH_TENANT_ID
- MS_GRAPH_CLIENT_SECRET
- MS_TOKEN_ENCRYPTION_KEY : clé aléatoire pour chiffrer le refresh token Microsoft

Déploiement : le Dockerfile construit l'export Web et l'API dans un seul service HTTPS. Le serveur sert le SPA et /api sur la même origine.

Base : appliquer les migrations Drizzle existantes à DATABASE_URL avec `pnpm db:push` avant le premier usage.

Microsoft Entra : enregistrer exactement `https://<service>.onrender.com/api/microsoft/callback` comme Redirect URI Web.

Important : conserver le spending limit TiDB à 0 pour empêcher toute facturation au-delà du quota gratuit. Render Free peut se mettre en veille après inactivité; le premier accès après veille peut donc être plus lent.
