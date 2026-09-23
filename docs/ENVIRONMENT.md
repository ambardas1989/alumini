# Environment Variables Reference

## Backend (alumini service on Render)

| Variable | Production value | Notes |
|---|---|---|
| NODE_ENV | production | |
| SUPABASE_URL | https://forkamymzckhwkaqegnn.supabase.co | |
| SUPABASE_ANON_KEY | sb_publishable_... | Safe to expose |
| SUPABASE_SERVICE_ROLE_KEY | sb_secret_... | Never expose publicly |
| JWT_SECRET | (random 32+ chars) | |
| JWT_EXPIRY | 7d | |
| MFA_ISSUER | AlumTribe | Shown in authenticator app |
| GOOGLE_CLIENT_ID | (from Google Cloud Console) | |
| GOOGLE_CLIENT_SECRET | (from Google Cloud Console) | |
| GOOGLE_CALLBACK_URL | https://api.alumtribe.com/v1/auth/google/callback | |
| FRONTEND_URL | https://alumtribe.com | REQUIRED — Google OAuth redirect |
| CORS_ORIGINS | https://alumtribe.com,https://www.alumtribe.com | |
| APP_URL | https://api.alumtribe.com | |
| RESEND_API_KEY | re_xxxxx | From resend.com — emails log to console if missing |
| FROM_EMAIL | noreply@alumtribe.com | Must be verified domain in Resend |
| LOG_LEVEL | debug | Change to 'info' before public launch — see docs/DEVELOPMENT.md |
| LINKEDIN_CLIENT_ID | (from LinkedIn Developer Portal) | Public — also needed as NEXT_PUBLIC_LINKEDIN_CLIENT_ID on the web service |
| LINKEDIN_CLIENT_SECRET | (from LinkedIn Developer Portal) | Never expose publicly |

## Web (alumini-web service on Render)

| Variable | Production value | Notes |
|---|---|---|
| NEXT_PUBLIC_API_URL | https://api.alumtribe.com/v1 | |
| NEXT_PUBLIC_SUPABASE_URL | https://forkamymzckhwkaqegnn.supabase.co | |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | sb_publishable_... | |
| NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED | true | |
| NEXT_PUBLIC_LINKEDIN_CLIENT_ID | (from LinkedIn Developer Portal) | Same value as backend's LINKEDIN_CLIENT_ID — public |
| HOSTNAME | 0.0.0.0 | Required for Render proxy |
| NODE_ENV | production | |
| PORT | 3000 | |

## Pending setup (not yet configured)

| What | Where | Notes |
|---|---|---|
| Zoho Mail MX records | Cloudflare DNS | For hello@alumtribe.com mailbox |
| Firebase FCM | firebase.google.com | Push notifications — mobile P1 |

## Node version

Both services require Node 22+.
Controlled by .node-version in project root.
Warning: on Windows, this file may save as UTF-16.
If Render picks up wrong Node version, check file encoding.
