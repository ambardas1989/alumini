/**
 * "Connect LinkedIn" OAuth — scoped to name/photo only, see
 * apps/backend/src/modules/auth/auth.service.ts's connectLinkedin() doc
 * comment for why. The client id is public (safe to ship to the browser);
 * only the client secret is server-only.
 */
export const LINKEDIN_CALLBACK_PATH = '/auth/linkedin/callback';

export function isLinkedInConnectEnabled(): boolean {
  return !!process.env.NEXT_PUBLIC_LINKEDIN_CLIENT_ID;
}

export function getLinkedInRedirectUri(): string {
  return `${window.location.origin}${LINKEDIN_CALLBACK_PATH}`;
}

export function buildLinkedInAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.NEXT_PUBLIC_LINKEDIN_CLIENT_ID ?? '',
    redirect_uri: getLinkedInRedirectUri(),
    scope: 'openid profile email',
    state,
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
}
