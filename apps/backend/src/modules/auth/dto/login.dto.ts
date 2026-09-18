import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  // Intentionally loose (min 1) — we never want to leak password policy
  // details (like the signup min-length) through a login-side validation error.
  @MinLength(1)
  password: string;
}
