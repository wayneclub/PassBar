import { Module } from '@nestjs/common';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { GeminiFeedbackController } from './gemini-feedback.controller';
import { GeminiFeedbackService } from './gemini-feedback.service';

@Module({
  controllers: [FeedbackController, GeminiFeedbackController],
  providers: [FeedbackService, GeminiFeedbackService],
  exports: [GeminiFeedbackService],
})
export class FeedbackModule {}
