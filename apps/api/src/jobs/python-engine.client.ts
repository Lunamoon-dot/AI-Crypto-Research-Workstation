import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngineRunRequest, JsonRecord } from '../database/journal.types';

@Injectable()
export class PythonEngineClient {
  async runInline(request: EngineRunRequest): Promise<JsonRecord> {
    const dir = await mkdtemp(join(tmpdir(), 'lunacrypto-engine-'));
    const requestPath = join(dir, `${request.run_id}.json`);
    await writeFile(requestPath, JSON.stringify(request), 'utf8');

    const command = process.env.PYTHON_ENGINE_COMMAND ?? 'lunacrypto';
    const args = (process.env.PYTHON_ENGINE_ARGS ?? 'engine run --request')
      .split(' ')
      .filter(Boolean);

    return new Promise((resolve, reject) => {
      const child = spawn(command, [...args, requestPath], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr || `Python engine exited with code ${code}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as JsonRecord);
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}
