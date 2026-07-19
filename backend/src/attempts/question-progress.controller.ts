import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApprovedGuard } from '../auth/guards/approved.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { QuestionProgressService } from './question-progress.service';
import {
  SaveAnswerProgressDto,
  FilterQuestionProgressDto,
  SaveOmittedDto,
  SetQuestionMarkedDto,
} from './dto/question-progress.dto';

function parseList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

@Controller('attempts/question-progress')
@UseGuards(JwtAuthGuard, ApprovedGuard)
export class QuestionProgressController {
  constructor(private readonly progressService: QuestionProgressService) {}

  @Get('counts')
  getCounts(
    @CurrentUser() user: JwtPayload,
    @Query('totalQuestions') totalQuestions?: string,
  ) {
    return this.progressService.getStatusCounts(
      user.sub,
      Number(totalQuestions) || 0,
    );
  }

  @Get('all')
  getAll(@CurrentUser() user: JwtPayload) {
    return this.progressService.getAllUserProgress(user.sub);
  }

  @Get('marked')
  getMarked(
    @CurrentUser() user: JwtPayload,
    @Query('questionIds') questionIds?: string,
  ) {
    return this.progressService.getMarkedQuestionIds(
      user.sub,
      parseList(questionIds),
    );
  }

  @Get('filter')
  filterByStatus(
    @CurrentUser() user: JwtPayload,
    @Query('questionIds') questionIds?: string,
    @Query('unused') unused?: string,
    @Query('incorrect') incorrect?: string,
    @Query('marked') marked?: string,
    @Query('omitted') omitted?: string,
    @Query('correct') correct?: string,
  ) {
    return this.progressService.filterQuestionIdsByStatus(
      user.sub,
      parseList(questionIds),
      {
        Unused: unused === 'true',
        Incorrect: incorrect === 'true',
        Marked: marked === 'true',
        Omitted: omitted === 'true',
        Correct: correct === 'true',
      },
    );
  }

  /**
   * POST variant for large custom tests. Sending every eligible ID in a query
   * string exceeds browser/proxy URL limits once users select many chapters.
   */
  @Post('filter')
  filterByStatusPost(
    @CurrentUser() user: JwtPayload,
    @Body() dto: FilterQuestionProgressDto,
  ) {
    return this.progressService.filterQuestionIdsByStatus(user.sub, dto.questionIds, {
      Unused: dto.unused,
      Incorrect: dto.incorrect,
      Marked: dto.marked,
      Omitted: dto.omitted,
      Correct: dto.correct,
    });
  }

  @Get('stats/:questionId')
  getStats(@Param('questionId') questionId: string) {
    return this.progressService.getQuestionAnswerStats(questionId);
  }

  @Post('answer')
  saveAnswer(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SaveAnswerProgressDto,
  ) {
    return this.progressService.saveAnswerProgress({
      userId: user.sub,
      ...dto,
    });
  }

  @Post('mark')
  setMarked(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetQuestionMarkedDto,
  ) {
    return this.progressService.setQuestionMarked({ userId: user.sub, ...dto });
  }

  @Post('omitted')
  saveOmitted(@CurrentUser() user: JwtPayload, @Body() dto: SaveOmittedDto) {
    return this.progressService.saveOmittedProgress({
      userId: user.sub,
      questionIds: dto.questionIds,
    });
  }

  @Delete('clear')
  clear(@CurrentUser() user: JwtPayload) {
    return this.progressService.clearPracticeProgress(user.sub);
  }
}
