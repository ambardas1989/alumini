import { IsEmail, IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SignupDto {
  @ApiProperty({ description: 'Login email address' })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'Account password — 8-72 characters, at least one letter and one digit',
  })
  @IsString()
  // 72 chars mirrors the practical bcrypt/GoTrue limit — anything longer is
  // silently truncated by most password hashers, so reject it up front instead.
  @Length(8, 72)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Password must contain at least one letter and one number',
  })
  password: string;

  @ApiProperty({ description: 'Full name shown across the app' })
  @IsString()
  @Length(2, 120)
  fullName: string;
}
