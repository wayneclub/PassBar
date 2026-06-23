import { Module } from '@nestjs/common';
import { AttemptsModule } from '../attempts/attempts.module';
import { PushController } from './push.controller';
import { PushService } from './push.service';
import { PushCronController } from './push-cron.controller';
import { PushCronService } from './push-cron.service';

@Module({
  imports: [AttemptsModule],
  controllers: [PushController, PushCronController],
  providers: [PushService, PushCronService],
})
export class PushModule {}
