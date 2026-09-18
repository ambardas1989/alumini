import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response shape for GET /premium/status. Not a request-validation DTO —
 * neither premium endpoint takes a body or query params — this exists
 * purely so Swagger documents the response shape (the same reasoning
 * ClassroomModule's JoinClassroomDto documents for an intentionally empty
 * request DTO, just the read/write side).
 */
export class PremiumStatusDto {
  @ApiProperty()
  isPremium: boolean;

  @ApiPropertyOptional({ enum: ['monthly', 'annual'], nullable: true })
  plan: 'monthly' | 'annual' | null;

  @ApiPropertyOptional({ enum: ['active', 'cancelled', 'expired'], nullable: true })
  status: 'active' | 'cancelled' | 'expired' | null;

  @ApiPropertyOptional({ nullable: true })
  startedAt: string | null;

  @ApiPropertyOptional({ nullable: true })
  expiresAt: string | null;
}
