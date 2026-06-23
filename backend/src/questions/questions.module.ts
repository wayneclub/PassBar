import { Module } from '@nestjs/common';
import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';
import { QuestionReportsController } from './question-reports.controller';
import { QuestionReportsService } from './question-reports.service';
import { QuestionAiAnalysisController } from './question-ai-analysis.controller';
import { QuestionAiAnalysisService } from './question-ai-analysis.service';

@Module({
  controllers: [
    QuestionsController,
    QuestionReportsController,
    QuestionAiAnalysisController,
  ],
  providers: [
    QuestionsService,
    QuestionReportsService,
    QuestionAiAnalysisService,
  ],
  exports: [
    QuestionsService,
    QuestionReportsService,
    QuestionAiAnalysisService,
  ],
})
export class QuestionsModule {}
