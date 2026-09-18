/**
 * Requires a full `access` token (see JwtStrategy). Use on any route that
 * represents a genuinely logged-in user — e.g. POST /auth/logout.
 *
 * Exported from AuthModule so other feature modules can protect their own
 * routes the same way once they're built.
 */

import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
