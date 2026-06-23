import { Module } from '@nestjs/common';
import { QuestionsModule } from '../questions/questions.module';
import { PracticeSessionsController } from './practice-sessions.controller';
import { PracticeSessionsService } from './practice-sessions.service';
import { QuestionProgressController } from './question-progress.controller';
import { QuestionProgressService } from './question-progress.service';
import { TopicStudyController } from './topic-study.controller';
import { TopicStudyService } from './topic-study.service';
import { AchievementsController } from './achievements.controller';
import { AchievementsService } from './achievements.service';
import { PlannerController } from './planner.controller';
import { PlannerService } from './planner.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [QuestionsModule],
  controllers: [
    PracticeSessionsController,
    QuestionProgressController,
    TopicStudyController,
    AchievementsController,
    PlannerController,
    DashboardController,
  ],
  providers: [
    PracticeSessionsService,
    QuestionProgressService,
    TopicStudyService,
    AchievementsService,
    PlannerService,
    DashboardService,
  ],
  exports: [
    PracticeSessionsService,
    QuestionProgressService,
    TopicStudyService,
    AchievementsService,
    PlannerService,
    DashboardService,
  ],
})
export class AttemptsModule {}
