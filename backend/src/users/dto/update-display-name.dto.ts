import { IsString, MinLength } from 'class-validator';

export class UpdateDisplayNameDto {
  @IsString()
  @MinLength(1)
  fullName!: string;
}
