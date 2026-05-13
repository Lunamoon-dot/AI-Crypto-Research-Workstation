import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService, AuthenticatedUser } from './auth.service';

type HeaderValue = string | string[] | undefined;
type RequestWithAuth = {
  headers?: Record<string, HeaderValue>;
  user?: AuthenticatedUser;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const userId = firstHeader(request.headers?.['x-user-id']);
    request.user = this.auth.authenticate(userId);
    if (!request.user.id) {
      throw new UnauthorizedException('A user identity is required.');
    }
    return true;
  }
}

function firstHeader(value: HeaderValue): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}
