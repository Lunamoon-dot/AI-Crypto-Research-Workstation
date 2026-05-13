import { AuthContextValue } from '@/auth/auth-types';

export async function hostedAuthHeaders(
  auth: AuthContextValue,
): Promise<Record<string, string>> {
  const token = await auth.getApiToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
