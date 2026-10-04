import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListInstitutionVerificationsDto {
  @ApiPropertyOptional({ enum: ['pending', 'approved', 'rejected', 'expired'] })
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected', 'expired'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  classroomId?: string;

  @ApiPropertyOptional({ enum: ['email', 'peer_vouch', 'document', 'linkedin', 'personal_code', 'batch_code'] })
  @IsOptional()
  @IsIn(['email', 'peer_vouch', 'document', 'linkedin', 'personal_code', 'batch_code'])
  method?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  limit?: number;
}
