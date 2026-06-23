import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class GetCachedAnalysisDto {
  @IsString()
  questionId!: string;

  @IsOptional()
  @IsString()
  selectedChoice?: string;

  @IsOptional()
  @IsString()
  correctChoice?: string;

  @IsString()
  interfaceLanguage!: string;
}

export class SaveAnalysisDto extends GetCachedAnalysisDto {
  @IsOptional()
  @IsBoolean()
  isCorrect?: boolean;

  @IsString()
  analysisMarkdown!: string;

  @IsOptional()
  @IsString()
  model?: string;
}
