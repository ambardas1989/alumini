/**
 * Root application module.
 * Imports all feature modules and configures shared providers.
 *
 * Module dependencies are explicit — no circular imports.
 * Cross-module communication via EventEmitter, not direct imports.
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';

import { AuthModule } from './modules/auth/auth.module';
import { IdentityModule } from './modules/identity/identity.module';
import { ClassroomModule } from './modules/classroom/classroom.module';
import { MembershipModule } from './modules/membership/membership.module';
import { CorridorModule } from './modules/corridor/corridor.module';
import { DmModule } from './modules/dm/dm.module';
import { VerificationModule } from './modules/verification/verification.module';
import { EventsModule } from './modules/events/events.module';
import { NotificationModule } from './modules/notification/notification.module';
import { InstitutionModule } from './modules/institution/institution.module';
import { CodesModule } from './modules/codes/codes.module';
import { SearchModule } from './modules/search/search.module';
import { PremiumModule } from './modules/premium/premium.module';
import { AuditModule } from './modules/audit/audit.module';
import { AdminModule } from './modules/admin/admin.module';
import { LoggerModule } from './common/logger/logger.module';
import { EmailModule } from './common/email/email.module';

import { appConfig } from '@alumini/config/app';

@Module({
  imports: [
    // ── Configuration ───────────────────────────────────────────────────────
    // Loads .env file and makes process.env available app-wide
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // ── Event bus (cross-module communication) ──────────────────────────────
    // Modules emit events, other modules listen.
    // E.g. verification.approved → corridor posts system message → notification fires push
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      maxListeners: 20,
      verboseMemoryLeak: true,
    }),

    // ── Rate limiting ───────────────────────────────────────────────────────
    // Global throttler — specific limits also applied per-endpoint
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,   // 1 minute window
        limit: 100,    // 100 requests per minute global default
      },
    ]),

    // ── Cross-cutting ────────────────────────────────────────────────────────
    LoggerModule,       // @Global() — AppLogger injectable anywhere without importing this
    EmailModule,        // @Global() — EmailService injectable anywhere without importing this

    // ── Feature modules ─────────────────────────────────────────────────────
    AuditModule,        // Must come first — other modules depend on AuditService
    AuthModule,
    IdentityModule,
    InstitutionModule,
    ClassroomModule,
    MembershipModule,
    CorridorModule,
    DmModule,
    VerificationModule,
    EventsModule,
    NotificationModule,
    CodesModule,
    SearchModule,
    PremiumModule,
    AdminModule,
  ],
})
export class AppModule {}
