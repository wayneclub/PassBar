import { IsArray, IsOptional, IsString } from 'class-validator';

export class SubmitQuestionReportDto {
  @IsString()
  questionId!: string;

  @IsArray()
  @IsString({ each: true })
  categories!: string[];

  @IsString()
  language!: string;

  @IsOptional()
  @IsString()
  message?: string;
}
