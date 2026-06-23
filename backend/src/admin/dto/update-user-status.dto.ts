import { IsIn } from 'class-validator';

export class UpdateUserStatusDto {
  @IsIn(['pending', 'approved', 'rejected'])
  status!: 'pending' | 'approved' | 'rejected';
}
