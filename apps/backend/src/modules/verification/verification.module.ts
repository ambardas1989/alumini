/**
 * VerificationModule — all 6 verification methods, document lifecycle,
 * and status queries (SPEC.md §8, §15.3).
 *
 * Owns: verifications, verification_email_otps (004_verification_module.sql).
 * Reads/writes memberships, institution_codes, institutions, profiles
 * directly — the same established cross-module table-access pattern every
 * module since auth has used.
 *
 * Imports AuthModule for JwtAuthGuard (every route requires a session) and
 * MfaChallengeGuard (document approve/reject, per SPEC.md §11.2).
 */

import { Module } from '@nestjs/common';
import { VerificationService } from './verification.service';
import { VerificationController } from './verification.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [VerificationController],
  providers: [VerificationService],
  exports: [VerificationService],
})
export class VerificationModule {}
