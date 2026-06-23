import { IsDateString, IsOptional } from 'class-validator';

export class UpdateExamDateDto {
  @IsOptional()
  @IsDateString()
  examDate!: string | null;
}
