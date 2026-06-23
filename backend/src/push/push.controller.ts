import { Body, Controller, Delete, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { PushService } from './push.service';
import { DeleteSubscriptionDto, SaveSubscriptionDto } from './dto/push.dto';

@Controller('push/subscriptions')
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Post()
  save(@CurrentUser() user: JwtPayload, @Body() dto: SaveSubscriptionDto) {
    return this.pushService.saveSubscription({ userId: user.sub, ...dto });
  }

  @Delete()
  delete(@Body() dto: DeleteSubscriptionDto) {
    return this.pushService.deleteSubscription(dto.endpoint);
  }
}
