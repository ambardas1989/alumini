import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PersonaType } from '@alumini/types';

/**
 * Switches to a persona the caller already owns. Keyed by `type` alone,
 * matching profiles.active_persona (a bare type string, not institution-
 * scoped — see IdentityService's module-level comment for why that's a
 * schema limitation this module works within rather than around).
 */
export class SwitchPersonaDto {
  @ApiProperty({ enum: PersonaType })
  @IsEnum(PersonaType)
  type: PersonaType;
}
