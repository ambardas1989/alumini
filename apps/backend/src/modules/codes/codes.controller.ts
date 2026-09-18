/**
 * CodesController — HTTP surface for apps/backend/src/modules/codes.
 * Routes follow SPEC.md §11.5. Every route is a school-admin action
 * requiring both a full session (JwtAuthGuard) and a fresh MFA
 * re-challenge (MfaChallengeGuard, SPEC.md §11.2) — applied once at the
 * controller level since there is no non-admin route in this module.
 */

import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { CodesService } from './codes.service';
import { GeneratePersonalCodeDto } from './dto/generate-personal-code.dto';
import { GenerateBatchCodeDto } from './dto/generate-batch-code.dto';
import { ImportCsvDto } from './dto/import-csv.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MfaChallengeGuard } from '../auth/guards/mfa-challenge.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthTokenPayload } from '../auth/auth.types';

@ApiTags('codes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, MfaChallengeGuard)
@Controller('codes')
export class CodesController {
  constructor(private readonly codesService: CodesService) {}

  @Post('personal')
  @ApiOperation({ summary: 'Generate a personal (name/email-tied) institution code' })
  async generatePersonal(
    @CurrentUser() authToken: AuthTokenPayload,
    @Body() dto: GeneratePersonalCodeDto,
    @Req() req: Request,
  ) {
    return this.codesService.generatePersonalCode(authToken.sub, dto, req);
  }

  @Post('batch')
  @ApiOperation({ summary: 'Generate a batch (shared, capped) institution code' })
  async generateBatch(
    @CurrentUser() authToken: AuthTokenPayload,
    @Body() dto: GenerateBatchCodeDto,
    @Req() req: Request,
  ) {
    return this.codesService.generateBatchCode(authToken.sub, dto, req);
  }

  @Get(':classroomId')
  @ApiOperation({ summary: 'List all codes for a classroom, with computed active/redeemed/exhausted/expired status' })
  async list(@CurrentUser() authToken: AuthTokenPayload, @Param('classroomId') classroomId: string) {
    return this.codesService.listCodes(authToken.sub, classroomId);
  }

  @Post('import')
  @ApiOperation({ summary: 'CSV bulk import — generates a personal code per student row' })
  async importCsv(
    @CurrentUser() authToken: AuthTokenPayload,
    @Body() dto: ImportCsvDto,
    @Req() req: Request,
  ) {
    return this.codesService.importCsv(authToken.sub, dto, req);
  }
}
