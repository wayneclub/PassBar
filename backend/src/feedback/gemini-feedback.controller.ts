import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtOrCronGuard } from '../common/guards/jwt-or-cron.guard';
import { GeminiFeedbackRequestDto, GeminiFeedbackService } from './gemini-feedback.service';

@Controller('gemini-feedback')
@UseGuards(JwtOrCronGuard)
export class GeminiFeedbackController {
  constructor(private readonly geminiFeedbackService: GeminiFeedbackService) {}

  @Post()
  async handleFeedback(@Body() dto: GeminiFeedbackRequestDto) {
    if (dto.action === 'status') {
      return this.geminiFeedbackService.getStatus();
    }
    return this.geminiFeedbackService.generateFeedback(dto);
  }
}
