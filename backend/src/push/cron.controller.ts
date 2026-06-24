import { Controller, Get, UseGuards } from '@nestjs/common';
import { CronSecretGuard } from '../common/guards/cron-secret.guard';
import { PushCronService } from './push-cron.service';

@Controller('cron')
@UseGuards(CronSecretGuard)
export class CronController {
  constructor(private readonly pushCronService: PushCronService) {}

  @Get('notifications')
  runNotifications() {
    return this.pushCronService.runHourlyNotifications();
  }
}
