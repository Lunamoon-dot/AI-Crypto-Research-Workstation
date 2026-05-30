import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';

test('API application context starts with default local configuration', async () => {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  assert.ok(app);
  await app.close();
});
