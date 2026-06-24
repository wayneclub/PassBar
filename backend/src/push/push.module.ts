import { Module } from '@nestjs/common';
import { AttemptsModule } from '../attempts/attempts.module';
import { PushController } from './push.controller';
import { PushService } from './push.service';
import { PushCronController } from './push-cron.controller';
import { PushCronService } from './push-cron.service';
import { CronController } from './cron.controller';

@Module({
  imports: [AttemptsModule],
  controllers: [PushController, PushCronController, CronController],
  providers: [PushService, PushCronService],
})
export class PushModule {}
