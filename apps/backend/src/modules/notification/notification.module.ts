/**
 * NotificationModule — push (FCM), in-app, and email (Resend) delivery
 * (SPEC.md §9, feature F40).
 *
 * Delivery (NotificationService's @OnEvent() handlers) is purely event-
 * driven, wired up automatically by the app-wide EventEmitterModule once
 * this module's provider is instantiated — nothing calls into that side
 * directly. NotificationController is this module's only HTTP surface,
 * added for the read side (GET /notifications, mark-read, unread-count) —
 * see NotificationService's own "Read side" section for why.
 */

import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';

@Module({
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
