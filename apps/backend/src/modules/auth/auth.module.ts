/**
 * AuthModule — JWT issuance, Google OAuth, email/password auth, and
 * mandatory MFA (TOTP + SMS fallback).
 *
 * Owns: sessions, mfa_totp_secrets, mfa_sms_challenges tables (see
 * supabase/migrations/002_auth_module.sql). No other module touches these
 * tables directly (SPEC.md §15.3 — "Each module owns its database tables").
 *
 * JwtAuthGuard, AuthTokenGuard, and MfaChallengeGuard are exported so other
 * modules can guard their own routes (e.g. the MFA re-challenge required
 * before sensitive admin actions per SPEC.md §11.2/§6.2 — see the
 * institution module) without re-implementing token or MFA verification.
 */

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthTokenGuard } from './guards/auth-token.guard';
import { MfaChallengeGuard } from './guards/mfa-challenge.guard';

@Module({
  imports: [
    PassportModule,
    // Secret and expiry are supplied per sign/verify call in AuthService —
    // different token purposes (access/refresh/mfa_*) use different
    // lifetimes, so there's no single global default worth registering here.
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, GoogleStrategy, JwtAuthGuard, AuthTokenGuard, MfaChallengeGuard],
  exports: [AuthService, JwtAuthGuard, AuthTokenGuard, MfaChallengeGuard, JwtModule],
})
export class AuthModule {}
