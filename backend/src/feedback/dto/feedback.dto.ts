import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';

export class SubmitFeedbackDto {
  @IsOptional()
  @IsIn(['content', 'bug', 'feature', 'account', 'other'])
  category?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  qid?: string;

  @IsOptional()
  @IsString()
  refSubject?: string;

  @IsOptional()
  @IsString()
  refChapter?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  message!: string;
}
