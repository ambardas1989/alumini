import { IsInt, IsUUID, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GenerateBatchCodeDto {
  @ApiProperty()
  @IsUUID()
  institutionId: string;

  @ApiProperty({ description: 'Classroom this code grants access to' })
  @IsUUID()
  classroomId: string;

  @ApiProperty({ description: 'Maximum number of redemptions — capped at appConfig.MAX_BATCH_CODE_REDEMPTIONS' })
  @IsInt()
  @Min(1)
  maxRedemptions: number;
}
