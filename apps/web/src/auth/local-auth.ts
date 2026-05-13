import { AuthContextValue } from '@/auth/auth-types';

export function localAuthHeaders(auth: AuthContextValue): Record<string, string> {
  return auth.getLocalHeaders();
}
