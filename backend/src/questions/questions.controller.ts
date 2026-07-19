import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { QuestionsService } from './questions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApprovedGuard } from '../auth/guards/approved.guard';

function parseList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseOptionalBoolean(value?: string): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

@Controller('questions')
@UseGuards(JwtAuthGuard, ApprovedGuard)
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  @Get('subjects')
  getSubjects(@Query('ncbe') ncbe?: string) {
    return this.questionsService.getSubjects(parseOptionalBoolean(ncbe));
  }

  @Get('ids')
  getQuestionIdsByChapterIds(
    @Query('chapterIds') chapterIds?: string,
    @Query('ncbe') ncbe?: string,
  ) {
    return this.questionsService.getQuestionIdsByChapterIds(
      parseList(chapterIds),
      parseOptionalBoolean(ncbe),
    );
  }

  @Get('ids-by-chapter')
  getAllQuestionIdsByChapter(@Query('ncbe') ncbe?: string) {
    return this.questionsService.getAllQuestionIdsByChapter(parseOptionalBoolean(ncbe));
  }

  @Get('by-ids')
  getQuestionsByIds(@Query('ids') ids?: string) {
    return this.questionsService.getQuestionsByIds(parseList(ids));
  }

  @Get()
  getQuestionsByChapterIds(
    @Query('chapterIds') chapterIds?: string,
    @Query('limit') limit?: string,
    @Query('ncbe') ncbe?: string,
  ) {
    const parsedLimit = Number(limit) > 0 ? Number(limit) : 50;
    return this.questionsService.getQuestionsByChapterIds(
      parseList(chapterIds),
      parsedLimit,
      parseOptionalBoolean(ncbe),
    );
  }
}
