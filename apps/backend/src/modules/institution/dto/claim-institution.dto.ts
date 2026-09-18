import { IsOptional, IsString, Length } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * SPEC.md §5.3 describes claim verification as institutional-email-OTP or
 * document upload — both genuinely belong to the (unbuilt) verification
 * module, not here. This DTO deliberately stays minimal: institution owns
 * the claim/approval *state machine*, not the evidence-gathering UX. A
 * free-text justification is enough for the platform-admin review queue in
 * the meantime.
 */
export class ClaimInstitutionDto {
  @ApiPropertyOptional({
    description: 'Optional note for the platform-admin review queue (e.g. your role at the institution)',
  })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  justification?: string;
}
