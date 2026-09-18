/**
 * PremiumController — HTTP surface for apps/backend/src/modules/premium.
 * Both routes call PremiumService.assertFeatureEnabled() first — when
 * appConfig.FEATURE_PREMIUM is off, even reading your own (necessarily
 * non-existent) premium status 403s, matching this task's explicit
 * requirement for "all premium endpoints" while the flag is off.
 */

import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { PremiumService } from './premium.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthTokenPayload } from '../auth/auth.types';

@ApiTags('premium')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('premium')
export class PremiumController {
  constructor(private readonly premiumService: PremiumService) {}

  @Get('status')
  @ApiOperation({ summary: "Caller's current premium status and expiry" })
  async status(@CurrentUser() authToken: AuthTokenPayload) {
    this.premiumService.assertFeatureEnabled();
    return this.premiumService.getStatus(authToken.sub);
  }

  @Get('features')
  @ApiOperation({ summary: 'Every feature premium unlocks (SPEC.md §13) — shown to free users too, as the paywall preview' })
  async features() {
    this.premiumService.assertFeatureEnabled();
    return this.premiumService.getFeatures();
  }
}
