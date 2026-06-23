import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpsertProgressDto {
  @IsString()
  chapterId!: string;

  @IsInt()
  @Min(0)
  viewedCount!: number;

  @IsOptional()
  @IsString()
  lastQuestionId!: string | null;

  @IsInt()
  @Min(0)
  lastQuestionIndex!: number;
}

export class UpsertQuestionStateDto {
  @IsString()
  questionId!: string;

  @IsOptional()
  @IsString()
  chapterId?: string;

  @IsOptional()
  @IsBoolean()
  isLearned?: boolean;

  @IsOptional()
  @IsBoolean()
  isMarked?: boolean;
}
