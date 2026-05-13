import { Injectable, UnauthorizedException } from '@nestjs/common';

export type AuthenticatedUser = {
  id: string;
};

@Injectable()
export class AuthService {
  resolveUser(userId?: string): string {
    const resolved = (userId ?? '').trim();
    if (!resolved) {
      throw new UnauthorizedException('A user identity is required.');
    }
    return resolved;
  }

  authenticate(userId?: string): AuthenticatedUser {
    return { id: this.resolveUser(userId) };
  }
}
