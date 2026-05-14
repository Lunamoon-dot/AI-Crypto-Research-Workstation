import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadWorkspaceEnv() {
  const candidates = [
    process.env.LUNACRYPTO_ENV_FILE,
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(__dirname, '../../../.env'),
    resolve(__dirname, '../../../../.env'),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const envPath = resolve(candidate);
    if (seen.has(envPath)) {
      continue;
    }
    seen.add(envPath);
    if (existsSync(envPath)) {
      process.loadEnvFile(envPath);
      return;
    }
  }
}
