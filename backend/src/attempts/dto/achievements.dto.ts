import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

class ChapterStatDto {
  @IsInt()
  @Min(0)
  totalAttempts!: number;

  @IsOptional()
  @IsNumber()
  lastAccuracy!: number | null;
}

class SubjectPerformanceDto {
  @IsString()
  name!: string;

  @IsNumber()
  score!: number;

  @IsNumber()
  correct!: number;

  @IsNumber()
  total!: number;
}

export class EvaluateBadgesDto {
  @IsInt()
  @Min(0)
  streakDays!: number;

  @IsNumber()
  @Min(0)
  maxDailyStudySeconds!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChapterStatDto)
  chapterStats!: ChapterStatDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubjectPerformanceDto)
  subjectPerformance!: SubjectPerformanceDto[];
}
