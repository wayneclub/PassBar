import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { DashboardService } from './dashboard.service';

@Controller('attempts/dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  getStats(@CurrentUser() user: JwtPayload) {
    return this.dashboardService.getDashboardStats(user.sub);
  }

  @Get('profile-stats')
  getProfileStats(@CurrentUser() user: JwtPayload) {
    return this.dashboardService.getProfileStats(user.sub);
  }

  @Get('performance-data')
  getPerformanceData(@CurrentUser() user: JwtPayload) {
    return this.dashboardService.getPerformanceData(user.sub);
  }

  @Get('review-sessions')
  getReviewSessions(
    @CurrentUser() user: JwtPayload,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('since') since?: string,
  ) {
    return this.dashboardService.getReviewSessions(user.sub, {
      page: Number(page) || 0,
      pageSize: Number(pageSize) || 15,
      since: since ? new Date(since) : undefined,
    });
  }

  @Get('review-filter-options')
  getReviewFilterOptions(@CurrentUser() user: JwtPayload) {
    return this.dashboardService.getReviewFilterOptions(user.sub);
  }
}
