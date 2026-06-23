import { Module } from '@nestjs/common';
import { AttemptsModule } from '../attempts/attempts.module';
import { AuthModule } from '../auth/auth.module';
import { TodosController } from './todos.controller';
import { TodosService } from './todos.service';

@Module({
  imports: [AttemptsModule, AuthModule],
  controllers: [TodosController],
  providers: [TodosService],
})
export class TodosModule {}
