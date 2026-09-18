/**
 * IdentityModule — user profile management and the persona system.
 *
 * Owns: profiles (read/update — creation is the auth module's job via the
 * handle_new_user DB trigger), personas (SPEC.md §15.3 — "identity/ → user
 * profiles, personas, persona switching").
 *
 * Imports AuthModule solely for JwtAuthGuard — every route here requires a
 * fully authenticated caller, and this reuses the auth module's token
 * verification rather than re-implementing it.
 */

import { Module } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { IdentityController } from './identity.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [IdentityController],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
