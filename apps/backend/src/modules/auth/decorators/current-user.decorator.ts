/**
 * Reads the authenticated caller off the request — populated either by
 * Passport (JwtAuthGuard / GoogleStrategy → req.user) or by AuthTokenGuard
 * (req.authToken). Works with either so controller methods don't need to
 * know which guard ran.
 */

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthTokenPayload } from '../auth.types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthTokenPayload => {
    const req = ctx.switchToHttp().getRequest();
    return req.user ?? req.authToken;
  },
);
