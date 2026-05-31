import { IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { WorkspaceMarketType } from '../workspace-metadata';

export class CreateWorkspaceDto {
  @IsString()
  @MinLength(1)
  @Matches(/\S/, { message: 'name must not be blank' })
  name: string;

  @IsString()
  @MinLength(1)
  @Matches(/\S/, { message: 'symbol must not be blank' })
  symbol: string;

  @IsOptional()
  @IsIn(['mixed', 'spot', 'perp'])
  market_type?: WorkspaceMarketType;

  @IsOptional()
  @IsString()
  default_timeframe?: string | null;
}
