/**
 * DmModule — 1:1 direct messages between verified classroom members
 * (TASKS_03.md TASK 06). Owns: direct_messages (015_direct_messages.sql).
 *
 * Imports AuthModule for JwtAuthGuard. No dependency on MembershipModule —
 * DmService queries `memberships` directly (service-role client), same
 * cross-module table-access pattern CorridorService uses.
 */

import { Module } from '@nestjs/common';
import { DmService } from './dm.service';
import { DmController } from './dm.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [DmController],
  providers: [DmService],
  exports: [DmService],
})
export class DmModule {}
