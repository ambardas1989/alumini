/**
 * EventsModule — event creation, listing, RSVPs, and deletion (SPEC.md §10).
 *
 * Owns: events, rsvps (001_initial_schema.sql). Reads memberships directly
 * for verified-member/admin access checks.
 *
 * Imports AuthModule solely for JwtAuthGuard — every route requires a
 * fully authenticated caller.
 */

import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
