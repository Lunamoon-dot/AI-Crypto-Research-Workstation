import { IsBoolean, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class CreateWatchlistDto {
  @IsString()
  @MinLength(1)
  @Matches(/\S/, { message: 'name must not be blank' })
  name: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
