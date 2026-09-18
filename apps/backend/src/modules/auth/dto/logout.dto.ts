import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class LogoutDto {
  @ApiPropertyOptional({
    default: false,
    description: 'Revoke every session for this account instead of just the current device',
  })
  @IsOptional()
  @IsBoolean()
  allDevices?: boolean;
}
