/**
 * CorridorModule — messaging (SPEC.md §9, §10): read/send/delete, plus
 * system messages and event cards posted on behalf of classroom,
 * verification, and (eventually) events modules.
 *
 * Owns: messages (001_initial_schema.sql). No new tables — Realtime is
 * already enabled on `messages` at the Supabase project level, nothing to
 * configure here (see CorridorService's module comment for the full
 * Realtime story, including two cross-module gaps that need attention
 * before the frontend can rely on it end-to-end).
 *
 * Imports MembershipModule for MembershipService.canAccessChannel() — the
 * server-side channel-access gate every read and write goes through — and
 * AuthModule for JwtAuthGuard.
 */

import { Module } from '@nestjs/common';
import { CorridorService } from './corridor.service';
import { CorridorController } from './corridor.controller';
import { AuthModule } from '../auth/auth.module';
import { MembershipModule } from '../membership/membership.module';

@Module({
  imports: [AuthModule, MembershipModule],
  controllers: [CorridorController],
  providers: [CorridorService],
  exports: [CorridorService],
})
export class CorridorModule {}
