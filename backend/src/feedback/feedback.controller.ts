import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { FeedbackService } from './feedback.service';
import { SubmitFeedbackDto } from './dto/feedback.dto';

@Controller('feedback')
@UseGuards(JwtAuthGuard)
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  submit(@CurrentUser() user: JwtPayload, @Body() dto: SubmitFeedbackDto) {
    return this.feedbackService.submit({ userId: user.sub, ...dto });
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin')
  list(
    @Query('categories') categories?: string,
    @Query('resolved') resolved?: string,
    @Query('limit') limit?: string,
  ) {
    return this.feedbackService.list({
      categories: categories
        ? categories.split(',')
        : ['content', 'bug', 'feature', 'account', 'other'],
      resolved: resolved === undefined ? undefined : resolved === 'true',
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Patch(':id/resolve')
  @UseGuards(RolesGuard)
  @Roles('admin')
  resolve(@Param('id') id: string) {
    return this.feedbackService.resolve(id);
  }
}
