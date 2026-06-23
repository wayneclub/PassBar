import { IsObject } from 'class-validator';

export class UpdateStudySettingsDto {
  @IsObject()
  studySettings!: Record<string, unknown>;
}
