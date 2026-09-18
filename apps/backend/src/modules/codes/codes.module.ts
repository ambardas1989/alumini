/**
 * CodesModule — personal/batch institution code generation, listing, and
 * CSV bulk import (SPEC.md §11.4, §11.5).
 *
 * Owns: institution_codes (001_initial_schema.sql,
 * expiry_logged_at added in 005_codes_module.sql). Reads/writes
 * classrooms, reads institutions/personas directly — the same established
 * cross-module table-access pattern every module since auth has used.
 *
 * Imports AuthModule for JwtAuthGuard and MfaChallengeGuard — every route
 * in this module is a school-admin action requiring both.
 */

import { Module } from '@nestjs/common';
import { CodesService } from './codes.service';
import { CodesController } from './codes.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [CodesController],
  providers: [CodesService],
  exports: [CodesService],
})
export class CodesModule {}
