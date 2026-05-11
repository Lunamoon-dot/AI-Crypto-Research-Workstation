import { Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class AuthService {
  resolveUser(userId?: string): string {
    const resolved = (userId ?? process.env.LOCAL_USER_ID ?? 'local_user').trim();
    if (!resolved) {
      throw new UnauthorizedException('A user identity is required.');
    }
    return resolved;
  }
}
