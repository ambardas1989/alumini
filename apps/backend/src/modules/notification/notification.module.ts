/**
 * NotificationModule — push (FCM), in-app, and email (Resend) delivery
 * (SPEC.md §9, feature F40).
 *
 * NO CONTROLLER, NO HTTP SURFACE. This module is purely event-driven —
 * NotificationService's @OnEvent() handlers are wired up automatically by
 * the app-wide EventEmitterModule (registered in app.module.ts) once this
 * module's provider is instantiated; nothing else needs to import or call
 * into this module directly. Exported anyway, matching every other
 * module's convention, in case a future module wants to call
 * sendInApp()/sendPush() synchronously rather than through an event.
 */

import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';

@Module({
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
