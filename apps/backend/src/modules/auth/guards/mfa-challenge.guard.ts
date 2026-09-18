/**
 * Re-verifies the caller's MFA factor on the SAME request as a sensitive
 * action (SPEC.md §11.2 — admin invite/remove/transfer, verification
 * approve/reject, code generation, bulk import all require MFA re-challenge;
 * SPEC.md §6.2 says the same for adding/removing co-admins specifically).
 *
 * This does NOT re-implement TOTP/SMS verification — it calls
 * AuthService.challengeMfa(), the exact same method POST /auth/mfa/challenge
 * uses. The only difference is where the code comes from: a normal
 * mfa/challenge call is its own round trip, while this guard expects the
 * caller to include their current code alongside the sensitive request
 * itself, via the `X-MFA-Code` header (kept out of each endpoint's own DTO
 * body since that body already carries the operation's real payload).
 *
 * Must run AFTER a guard that populates `req.user` with a full
 * 'access'-purpose AuthTokenPayload (i.e. always pair this with
 * JwtAuthGuard, in that order: `@UseGuards(JwtAuthGuard, MfaChallengeGuard)`).
 */

import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth.service';
import { AuthTokenPayload } from '../auth.types';
import { MfaChallengeDto } from '../dto/mfa-challenge.dto';

@Injectable()
export class MfaChallengeGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthTokenPayload }>();
    const authToken = req.user;

    if (!authToken) {
      throw new UnauthorizedException('MFA re-challenge requires a fully authenticated session');
    }

    const header = req.headers['x-mfa-code'];
    if (!header || Array.isArray(header)) {
      throw new UnauthorizedException(
        'This action requires MFA re-challenge — supply your current code in the X-MFA-Code header',
      );
    }

    const dto: MfaChallengeDto = { code: header };

    // challengeMfa() throws UnauthorizedException on a wrong/expired code —
    // that propagates out of the guard exactly like any other rejection.
    // Because authToken.purpose is 'access' here (JwtAuthGuard already
    // enforced that), challengeMfa() takes its sensitive-action-reauth
    // branch and returns { verified: true } without minting new tokens.
    await this.authService.challengeMfa(authToken, dto, req);
    return true;
  }
}
