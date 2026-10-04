/**
 * InstitutionModule — institution search, the claim flow, and co-admin
 * management (SPEC.md §6.2, §11).
 *
 * Owns: institutions (already created in 001_initial_schema.sql) and
 * institution_admin_invites (003_institution_module.sql). Reads/writes
 * personas directly too — see InstitutionService's module-level comment
 * for why.
 *
 * Imports AuthModule for JwtAuthGuard (every route but the public invite-
 * accept magic link requires a full session) and MfaChallengeGuard (the
 * four co-admin-management routes additionally require MFA re-challenge),
 * plus JwtService (exported by AuthModule) to sign/verify the co-admin
 * invitation token.
 */

import { Module } from '@nestjs/common';
import { InstitutionService } from './institution.service';
import { InstitutionController } from './institution.controller';
import { InstitutionAdminController } from './institution-admin.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  // TASKS_11 TASK 01 — InstitutionAdminController is a second, thin
  // controller over the same InstitutionService (see its own header
  // comment for why this isn't a separate module).
  controllers: [InstitutionController, InstitutionAdminController],
  providers: [InstitutionService],
  exports: [InstitutionService],
})
export class InstitutionModule {}
