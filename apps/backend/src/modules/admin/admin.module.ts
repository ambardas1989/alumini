/**
 * AdminModule — the school admin portal (SPEC.md §11) plus platform-admin
 * institution-claim review.
 *
 * Owns no tables of its own — see AdminService's module-level comment for
 * the full aggregation-vs-delegation reasoning. Imports VerificationModule
 * and InstitutionModule specifically to inject VerificationService and
 * InstitutionService for the four delegated write operations (document
 * approve/reject, claim approve/reject) — NOT for the read/aggregation
 * endpoints, which query tables directly instead.
 *
 * Imports AuthModule for JwtAuthGuard and MfaChallengeGuard (every
 * mutating route requires MFA re-challenge, per SPEC.md §11.2).
 */

import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { AuthModule } from '../auth/auth.module';
import { VerificationModule } from '../verification/verification.module';
import { InstitutionModule } from '../institution/institution.module';

@Module({
  imports: [AuthModule, VerificationModule, InstitutionModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
