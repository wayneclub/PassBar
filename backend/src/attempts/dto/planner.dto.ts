import {
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class GenerateMissionSessionDto {
  @IsInt()
  targetQuota!: number;

  @IsOptional()
  @IsObject()
  subjectQuotas?: Record<string, number>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  reviewChapterIds?: string[];

  @IsOptional()
  @IsInt()
  reviewQuota?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferredNewChapterIds?: string[];
}

export class GenerateIncorrectSessionDto {
  @IsInt()
  targetQuota!: number;
}
