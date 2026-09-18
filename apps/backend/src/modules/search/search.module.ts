/**
 * SearchModule — teacher cross-classroom student search (SPEC.md §12.2).
 *
 * Institution search lives in InstitutionModule (GET /institution/search)
 * — not duplicated here; see SearchController's header comment.
 *
 * Owns nothing new — reads personas/memberships/profiles/classrooms
 * directly, the same established cross-module table-access pattern every
 * module since auth has used.
 *
 * Imports AuthModule solely for JwtAuthGuard — every route requires a
 * fully authenticated caller.
 */

import { Module } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
