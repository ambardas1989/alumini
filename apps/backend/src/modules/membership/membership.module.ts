/**
 * MembershipModule — roles, channel access rules, and verification-status
 * queries for classroom memberships (SPEC.md §7.2–§7.4).
 *
 * MembershipService is exported so other modules can inject it and call
 * canAccessChannel() directly — the corridor module (not yet built) is the
 * intended consumer, per SPEC.md §7.3.
 *
 * Imports AuthModule solely for JwtAuthGuard — every route requires a
 * fully authenticated caller.
 */

import { Module } from '@nestjs/common';
import { MembershipService } from './membership.service';
import { MembershipController } from './membership.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [MembershipController],
  providers: [MembershipService],
  exports: [MembershipService],
})
export class MembershipModule {}
