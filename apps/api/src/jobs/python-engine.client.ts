import { Injectable } from '@nestjs/common';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { EngineRunRequest, JsonRecord } from '../database/journal.types';

interface EngineInvocation {
  command: string;
  args: string[];
  cwd?: string;
}

export interface PythonEngineRunOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface EngineEvaluateRequest {
  thesis_id: string;
  workspace_id: string;
  window_days: number;
  metadata?: JsonRecord;
}

@Injectable()
export class PythonEngineClient {
  async runInline(
    request: EngineRunRequest,
    options: PythonEngineRunOptions = {},
  ): Promise<JsonRecord> {
    return runEngineRequestFile(
      request,
      `${request.run_id}.json`,
      resolveEngineInvocation(),
      options,
    );
  }

  async evaluateThesis(
    request: EngineEvaluateRequest,
    options: PythonEngineRunOptions = {},
  ): Promise<JsonRecord> {
    return runEngineRequestFile(
      request,
      `${request.thesis_id}-evaluation.json`,
      resolveCliInvocation(['engine', 'evaluate', '--request']),
      options,
    );
  }
}

export function runPythonCliJson(
  args: string[],
  options: PythonEngineRunOptions = {},
): Promise<JsonRecord> {
  return runJsonInvocation(resolveCliInvocation(args), options);
}

function runJsonInvocation(
  invocation: EngineInvocation,
  options: PythonEngineRunOptions,
): Promise<JsonRecord> {
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let timedOut = false;
    const timeout =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill();
          }, options.timeoutMs)
        : undefined;
    const abort = () => {
      child.kill();
    };
    if (options.signal?.aborted) {
      abort();
    }
    options.signal?.addEventListener('abort', abort, { once: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      options.signal?.removeEventListener('abort', abort);
      if (timeout) {
        clearTimeout(timeout);
      }
      reject(error);
    });
    child.on('close', (code) => {
      options.signal?.removeEventListener('abort', abort);
      if (timeout) {
        clearTimeout(timeout);
      }
      if (timedOut) {
        reject(new Error(`Python command timed out after ${options.timeoutMs}ms.`));
        return;
      }
      if (options.signal?.aborted) {
        reject(new Error('Python engine aborted.'));
        return;
      }
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(stderr || `Python engine exited with code ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as JsonRecord;
        resolve(parsed);
      } catch (error) {
        if (code !== 0) {
          reject(new Error(stderr || `Python engine exited with code ${code}`));
          return;
        }
        reject(error);
        return;
      }
    });
  });
}

async function runEngineRequestFile(
  request: unknown,
  fileName: string,
  invocation: EngineInvocation,
  options: PythonEngineRunOptions,
): Promise<JsonRecord> {
  const dir = await mkdtemp(join(tmpdir(), 'lunacrypto-engine-'));
  const requestPath = join(dir, fileName.replace(/[^a-z0-9._-]+/gi, '-'));
  await writeFile(requestPath, JSON.stringify(request), 'utf8');
  return runJsonInvocation(
    {
      ...invocation,
      args: [...invocation.args, requestPath],
    },
    options,
  );
}

function resolveEngineInvocation(): EngineInvocation {
  const configured = process.env.PYTHON_ENGINE_COMMAND?.trim();
  if (configured) {
    return {
      command: configured,
      args: splitArgs(process.env.PYTHON_ENGINE_ARGS ?? 'engine run --request'),
      cwd: process.env.PYTHON_ENGINE_CWD?.trim() || undefined,
    };
  }

  const aiServiceDir = resolveAiServiceDir();
  const python = aiServiceDir ? resolvePythonCommand(aiServiceDir) : null;
  if (python && aiServiceDir) {
    return {
      command: python,
      args: ['-m', 'cli.main', 'engine', 'run', '--request'],
      cwd: aiServiceDir,
    };
  }

  const executable = process.platform === 'win32' ? 'lunacrypto.exe' : 'lunacrypto';
  const cwd = aiServiceDir ?? process.cwd();
  const candidates = unique([
    aiServiceDir
      ? join(aiServiceDir, '.venv', binDir(), executable)
      : '',
    join(process.cwd(), '.venv', binDir(), executable),
    join(process.cwd(), '..', '..', '.venv', binDir(), executable),
    join(__dirname, '..', '..', '..', '..', '..', '.venv', binDir(), executable),
  ]);
  return {
    command: candidates.find((candidate) => candidate && isHealthyExecutable(candidate, ['--help'], cwd)) ?? 'lunacrypto',
    args: ['engine', 'run', '--request'],
    cwd,
  };
}

function resolveCliInvocation(args: string[]): EngineInvocation {
  const aiServiceDir = resolveAiServiceDir();
  const python = aiServiceDir ? resolvePythonCommand(aiServiceDir) : null;
  if (python && aiServiceDir) {
    return {
      command: python,
      args: ['-m', 'cli.main', ...args],
      cwd: aiServiceDir,
    };
  }

  const executable = process.platform === 'win32' ? 'lunacrypto.exe' : 'lunacrypto';
  const cwd = aiServiceDir ?? process.cwd();
  const candidates = unique([
    aiServiceDir
      ? join(aiServiceDir, '.venv', binDir(), executable)
      : '',
    join(process.cwd(), '.venv', binDir(), executable),
    join(process.cwd(), '..', '..', '.venv', binDir(), executable),
    join(__dirname, '..', '..', '..', '..', '..', '.venv', binDir(), executable),
  ]);
  return {
    command: candidates.find((candidate) => candidate && isHealthyExecutable(candidate, ['--help'], cwd)) ?? 'lunacrypto',
    args,
    cwd,
  };
}

function splitArgs(value: string): string[] {
  return value.split(' ').filter(Boolean);
}

function resolveAiServiceDir(): string | null {
  const configured = process.env.PYTHON_ENGINE_CWD?.trim();
  const candidates = unique([
    configured ? resolve(configured) : '',
    resolve(process.cwd()),
    resolve(process.cwd(), 'apps', 'ai-service'),
    resolve(process.cwd(), '..', 'ai-service'),
    resolve(process.cwd(), '..', '..', 'apps', 'ai-service'),
    resolve(__dirname, '..', '..', '..', '..', '..', 'apps', 'ai-service'),
    resolve(__dirname, '..', '..', '..', '..', 'apps', 'ai-service'),
  ]);
  return candidates.find((candidate) =>
    Boolean(candidate && existsSync(join(candidate, 'cli', 'main.py'))),
  ) ?? null;
}

function resolvePythonCommand(aiServiceDir: string): string | null {
  const repoRoot = resolve(aiServiceDir, '..', '..');
  const executable = process.platform === 'win32' ? 'python.exe' : 'python';
  const candidates = unique([
    join(aiServiceDir, '.venv', binDir(), executable),
    join(repoRoot, '.venv', binDir(), executable),
    process.platform === 'win32' ? 'python.exe' : 'python',
    'python',
    'python3',
  ]);
  return (
    candidates.find((candidate) =>
      isHealthyExecutable(candidate, ['--version'], aiServiceDir),
    ) ?? null
  );
}

function isHealthyExecutable(
  command: string,
  args: string[],
  cwd: string,
): boolean {
  if (command.includes('\\') || command.includes('/')) {
    if (!existsSync(command)) {
      return false;
    }
  }
  const result = spawnSync(command, args, {
    cwd,
    windowsHide: true,
    stdio: 'ignore',
    timeout: 5000,
  });
  return !result.error && result.status === 0;
}

function binDir(): string {
  return process.platform === 'win32' ? 'Scripts' : 'bin';
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
