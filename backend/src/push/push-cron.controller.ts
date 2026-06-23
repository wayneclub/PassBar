import { Controller, Post, UseGuards } from '@nestjs/common';
import { CronSecretGuard } from '../common/guards/cron-secret.guard';
import { PushCronService } from './push-cron.service';

@Controller('internal/cron')
@UseGuards(CronSecretGuard)
export class PushCronController {
  constructor(private readonly pushCronService: PushCronService) {}

  @Post('notifications')
  runNotifications() {
    return this.pushCronService.runHourlyNotifications();
  }
}
