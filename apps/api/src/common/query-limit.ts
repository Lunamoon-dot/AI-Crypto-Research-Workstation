import { BadRequestException } from '@nestjs/common';

export type ListLimitOptions = {
  defaultLimit: number;
  maxLimit: number;
};

export function parseListLimit(
  value: string | number | undefined,
  options: ListLimitOptions,
): number {
  if (value === undefined) {
    return options.defaultLimit;
  }

  const trimmed = typeof value === 'string' ? value.trim() : value;
  if (trimmed === '') {
    return options.defaultLimit;
  }

  const parsed = typeof trimmed === 'number' ? trimmed : Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new BadRequestException('limit must be a valid number');
  }

  return clampListLimit(parsed, options);
}

export function clampListLimit(
  value: number,
  options: ListLimitOptions,
): number {
  if (!Number.isFinite(value)) {
    throw new BadRequestException('limit must be a valid number');
  }
  return Math.min(Math.max(Math.trunc(value), 1), options.maxLimit);
}
