import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { QuestionReportsService } from './question-reports.service';
import { SubmitQuestionReportDto } from './dto/submit-question-report.dto';

@Controller('question-reports')
@UseGuards(JwtAuthGuard)
export class QuestionReportsController {
  constructor(private readonly reportsService: QuestionReportsService) {}

  @Post()
  submit(@CurrentUser() user: JwtPayload, @Body() dto: SubmitQuestionReportDto) {
    return this.reportsService.submit({ ...dto, userId: user.sub });
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin')
  list(@Query('resolved') resolved?: string, @Query('limit') limit?: string) {
    return this.reportsService.list({
      resolved: resolved === undefined ? undefined : resolved === 'true',
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Patch(':id/resolve')
  @UseGuards(RolesGuard)
  @Roles('admin')
  resolve(@Param('id') id: string) {
    return this.reportsService.resolve(id);
  }
}
