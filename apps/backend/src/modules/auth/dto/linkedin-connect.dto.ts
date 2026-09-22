import { IsString, IsUrl, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LinkedinConnectDto {
  @ApiProperty({ description: 'Authorization code from the LinkedIn OAuth redirect' })
  @IsString()
  @MinLength(1)
  code: string;

  @ApiProperty({ description: 'Must exactly match the redirect_uri used to start the LinkedIn OAuth flow' })
  @IsUrl({ require_tld: false })
  redirectUri: string;
}
