import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { AchievementsService } from './achievements.service';
import { EvaluateBadgesDto } from './dto/achievements.dto';

@Controller('attempts/achievements')
@UseGuards(JwtAuthGuard)
export class AchievementsController {
  constructor(private readonly achievementsService: AchievementsService) {}

  @Post('evaluate')
  evaluate(@CurrentUser() user: JwtPayload, @Body() dto: EvaluateBadgesDto) {
    return this.achievementsService.evaluateUserBadges(user.sub, dto);
  }

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.achievementsService.fetchUserBadges(user.sub);
  }
}
