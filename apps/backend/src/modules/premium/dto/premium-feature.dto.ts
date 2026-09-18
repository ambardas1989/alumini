import { ApiProperty } from '@nestjs/swagger';

/** Response shape for one entry of GET /premium/features. See premium-status.dto.ts's comment on why this exists despite no request to validate. */
export class PremiumFeatureDto {
  @ApiProperty({ description: 'Stable machine-readable identifier' })
  key: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  description: string;

  @ApiProperty({ description: 'Whether this feature is currently built and toggled on, independent of the caller’s own premium status' })
  enabled: boolean;
}
