import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { TopicStudyService } from './topic-study.service';
import {
  UpsertProgressDto,
  UpsertQuestionStateDto,
} from './dto/topic-study.dto';

function parseList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseOptionalBoolean(value?: string): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

@Controller('attempts/topic-study')
@UseGuards(JwtAuthGuard)
export class TopicStudyController {
  constructor(private readonly topicStudyService: TopicStudyService) {}

  @Get('progress')
  getProgress(@CurrentUser() user: JwtPayload) {
    return this.topicStudyService.getProgressByUser(user.sub);
  }

  @Put('progress')
  upsertProgress(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpsertProgressDto,
  ) {
    return this.topicStudyService.upsertProgress({ userId: user.sub, ...dto });
  }

  @Delete('progress')
  deleteProgress(
    @CurrentUser() user: JwtPayload,
    @Query('chapterIds') chapterIds?: string,
  ) {
    return this.topicStudyService.deleteProgressForUser(
      user.sub,
      parseList(chapterIds) || undefined,
    );
  }

  @Get('states')
  getStates(
    @CurrentUser() user: JwtPayload,
    @Query('questionIds') questionIds?: string,
  ) {
    return this.topicStudyService.getQuestionStates(
      user.sub,
      parseList(questionIds),
    );
  }

  @Get('states/marked')
  getMarked(
    @CurrentUser() user: JwtPayload,
    @Query('questionIds') questionIds?: string,
  ) {
    return this.topicStudyService.getMarkedQuestionIds(
      user.sub,
      parseList(questionIds) || undefined,
    );
  }

  @Get('states/marked-chapters')
  getMarkedChapters(@CurrentUser() user: JwtPayload) {
    return this.topicStudyService.getMarkedChapterIds(user.sub);
  }

  @Get('states/chapter-counts')
  getChapterCounts(
    @CurrentUser() user: JwtPayload,
    @Query('ncbe') ncbe?: string,
  ) {
    return this.topicStudyService.getChapterStateCounts(
      user.sub,
      parseOptionalBoolean(ncbe),
    );
  }

  @Put('states')
  upsertState(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpsertQuestionStateDto,
  ) {
    return this.topicStudyService.upsertQuestionState({
      userId: user.sub,
      ...dto,
    });
  }

  @Delete('states/:chapterId')
  deleteStatesForChapter(
    @CurrentUser() user: JwtPayload,
    @Param('chapterId') chapterId: string,
  ) {
    return this.topicStudyService.deleteQuestionStatesForChapter(
      user.sub,
      chapterId,
    );
  }

  @Delete('clear')
  clearAll(@CurrentUser() user: JwtPayload) {
    return this.topicStudyService.clearBrowseProgress(user.sub);
  }
}
