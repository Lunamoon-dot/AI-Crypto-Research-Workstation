import { IsArray } from 'class-validator';

export class UpdateWorkspaceNewsSourcesDto {
  @IsArray()
  sources: unknown[];
}
