/**
 * SearchController — HTTP surface for apps/backend/src/modules/search.
 *
 * NOTE: institution search (GET /institutions?q=&countryCode=) already
 * exists at InstitutionController — GET /institution/search — and is NOT
 * duplicated here. This controller only covers SPEC.md §12.2's
 * teacher-facing student search.
 */

import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { SearchService } from './search.service';
import { SearchStudentsDto } from './dto/search-students.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthTokenPayload } from '../auth/auth.types';

@ApiTags('search')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get('students')
  @ApiOperation({ summary: "Search students by name across the caller's verified classrooms — teacher persona required" })
  async searchStudents(@CurrentUser() authToken: AuthTokenPayload, @Query() dto: SearchStudentsDto) {
    return this.searchService.searchStudents(authToken.sub, dto);
  }

  @Get('students/:userId')
  @ApiOperation({ summary: 'Student profile + shared classrooms, for recommendation-letter context — teacher persona required' })
  async getStudentProfile(
    @CurrentUser() authToken: AuthTokenPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.searchService.getStudentProfile(authToken.sub, userId);
  }
}
