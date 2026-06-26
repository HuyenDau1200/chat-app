import { Matches } from 'class-validator';

export class LoginDto {
  @Matches(/^[A-Za-z0-9_]{3,20}$/, {
    message: 'username must be 3–20 chars: letters, numbers, underscore',
  })
  username: string;
}
