import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectInstitutionRequestDto {
  @ApiProperty({ description: 'Shown to the requester and stored on the request row' })
  @IsString()
  @Length(1, 500)
  reason: string;
}
