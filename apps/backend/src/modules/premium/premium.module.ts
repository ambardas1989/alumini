/**
 * PremiumModule — feature-flag and payment-status gating (SPEC.md §13).
 * No payment processing — see PremiumService's module comment.
 *
 * Owns: premium_subscriptions (007_premium_module.sql).
 *
 * PremiumService is exported so other (future) modules can inject it and
 * call isPremium()/assertPremium() directly as a gate, without going
 * through HTTP.
 *
 * Imports AuthModule solely for JwtAuthGuard.
 */

import { Module } from '@nestjs/common';
import { PremiumService } from './premium.service';
import { PremiumController } from './premium.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [PremiumController],
  providers: [PremiumService],
  exports: [PremiumService],
})
export class PremiumModule {}
