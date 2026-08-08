import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { PlannerService } from './planner.service';
import {
  GenerateIncorrectSessionDto,
  GenerateMissionSessionDto,
} from './dto/planner.dto';

@Controller('attempts/planner')
@UseGuards(JwtAuthGuard)
export class PlannerController {
  constructor(private readonly plannerService: PlannerService) {}

  @Get('today-mission')
  getTodayMission(@CurrentUser() user: JwtPayload) {
    return this.plannerService.fetchTodayMissionForUser(user.sub);
  }

  @Get('due-reviews')
  getDueReviews(@CurrentUser() user: JwtPayload) {
    return this.plannerService.fetchDueReviewChaptersForUser(user.sub);
  }

  @Get('projection')
  getProjection(@CurrentUser() user: JwtPayload) {
    return this.plannerService.projectSchedule(user.sub);
  }

  @Get('briefing')
  getBriefing(@CurrentUser() user: JwtPayload, @Query('lang') lang?: string) {
    return this.plannerService.generatePlanBriefing(user.sub, lang);
  }

  @Post('generate-mission-session')
  generateMissionSession(
    @CurrentUser() user: JwtPayload,
    @Body() dto: GenerateMissionSessionDto,
  ) {
    return this.plannerService.generateTodayMissionSession(
      user.sub,
      dto.targetQuota,
      dto.subjectQuotas,
      dto.reviewChapterIds,
      dto.reviewQuota,
      dto.preferredNewChapterIds,
    );
  }

  @Post('generate-incorrect-session')
  generateIncorrectSession(
    @CurrentUser() user: JwtPayload,
    @Body() dto: GenerateIncorrectSessionDto,
  ) {
    return this.plannerService.generateIncorrectSession(
      user.sub,
      dto.targetQuota,
    );
  }
}
