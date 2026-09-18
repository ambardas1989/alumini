import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectClaimDto {
  @ApiProperty({ description: 'Reason shown to the claimant and stored in the audit trail' })
  @IsString()
  @Length(1, 500)
  reason: string;
}
