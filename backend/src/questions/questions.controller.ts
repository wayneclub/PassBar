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

@Controller('questions')
@UseGuards(JwtAuthGuard, ApprovedGuard)
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  @Get('subjects')
  getSubjects() {
    return this.questionsService.getSubjects();
  }

  @Get('ids')
  getQuestionIdsByChapterIds(@Query('chapterIds') chapterIds?: string) {
    return this.questionsService.getQuestionIdsByChapterIds(
      parseList(chapterIds),
    );
  }

  @Get('ids-by-chapter')
  getAllQuestionIdsByChapter() {
    return this.questionsService.getAllQuestionIdsByChapter();
  }

  @Get('by-ids')
  getQuestionsByIds(@Query('ids') ids?: string) {
    return this.questionsService.getQuestionsByIds(parseList(ids));
  }

  @Get()
  getQuestionsByChapterIds(
    @Query('chapterIds') chapterIds?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = Number(limit) > 0 ? Number(limit) : 50;
    return this.questionsService.getQuestionsByChapterIds(
      parseList(chapterIds),
      parsedLimit,
    );
  }
}
