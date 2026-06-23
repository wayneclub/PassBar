import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { PracticeSessionsService } from './practice-sessions.service';
import { CreateSessionDto, SaveAnswerDto, UpdateSessionDto } from './dto/practice-session.dto';

@Controller('attempts/sessions')
@UseGuards(JwtAuthGuard)
export class PracticeSessionsController {
  constructor(private readonly sessionsService: PracticeSessionsService) {}

  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateSessionDto) {
    const id = await this.sessionsService.createSession({ userId: user.sub, ...dto });
    return { id };
  }

  @Get(':id')
  getSession(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query('answeredOnly') answeredOnly?: string,
  ) {
    return this.sessionsService.getSession(id, user.sub, { answeredOnly: answeredOnly === 'true' });
  }

  @Patch(':id')
  updateSession(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateSessionDto) {
    return this.sessionsService.updateSession({ sessionId: id, userId: user.sub, ...dto });
  }

  @Delete(':id')
  deleteSession(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.sessionsService.deleteSession(id, user.sub);
  }

  @Get(':id/answers')
  getAnswers(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.sessionsService.getAnswersForSession(id, user.sub);
  }

  @Post(':id/answers')
  saveAnswer(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: SaveAnswerDto) {
    return this.sessionsService.saveAnswer({ sessionId: id, userId: user.sub, ...dto });
  }

  @Delete(':id/answers')
  deleteAnswers(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.sessionsService.deleteAnswersForSession(id, user.sub);
  }
}
