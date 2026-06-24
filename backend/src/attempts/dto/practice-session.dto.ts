import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateSessionDto {
  @IsIn(['Tutor', 'Timed', 'TopicStudy', 'SimExam'])
  mode!: 'Tutor' | 'Timed' | 'TopicStudy' | 'SimExam';

  @IsArray()
  @IsString({ each: true })
  subjectNames!: string[];

  @IsArray()
  @IsString({ each: true })
  chapterIds!: string[];

  @IsArray()
  @IsString({ each: true })
  questionIds!: string[];
}

export class SaveAnswerDto {
  @IsString()
  questionId!: string;

  @IsString()
  selectedChoice!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  timeSpentSeconds?: number;
}

export class UpdateSessionDto {
  @IsIn(['In-Progress', 'Completed', 'Suspended'])
  status!: 'In-Progress' | 'Completed' | 'Suspended';

  @IsNumber()
  timeSpent!: number;

  @IsArray()
  @IsString({ each: true })
  questionIds!: string[];

  @IsArray()
  @IsString({ each: true })
  subjects!: string[];

  @IsArray()
  @IsString({ each: true })
  chapters!: string[];

  @IsObject()
  userAnswers!: Record<string, string>;

  @IsNumber()
  createdAt!: number;
}
