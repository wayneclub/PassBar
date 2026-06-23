import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class SaveAnswerProgressDto {
  @IsString()
  questionId!: string;

  @IsString()
  selectedChoice!: string;

  @IsString()
  correctAnswer!: string;

  @IsBoolean()
  isCorrect!: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  timeSpentSeconds?: number;
}

export class SetQuestionMarkedDto {
  @IsString()
  questionId!: string;

  @IsBoolean()
  isMarked!: boolean;
}

export class SaveOmittedDto {
  @IsArray()
  @IsString({ each: true })
  questionIds!: string[];
}

export class ClearProgressDto {
  @IsOptional()
  @IsIn(['practice', 'browse', 'all'])
  scope?: 'practice' | 'browse' | 'all';
}
