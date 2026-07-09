import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtOrCronGuard } from '../common/guards/jwt-or-cron.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { GeminiFeedbackRequestDto, GeminiFeedbackService } from './gemini-feedback.service';

@Controller('gemini-feedback')
@UseGuards(JwtOrCronGuard)
export class GeminiFeedbackController {
  constructor(private readonly geminiFeedbackService: GeminiFeedbackService) {}

  @Post()
  async handleFeedback(
    @Body() dto: GeminiFeedbackRequestDto,
    @CurrentUser() user?: JwtPayload,
  ) {
    if (dto.action === 'status') {
      return this.geminiFeedbackService.getStatus();
    }
    const result = await this.geminiFeedbackService.generateFeedback(dto);
    // 表現診斷結果落庫，重新整理後仍可顯示（cron 認證路徑沒有 user，略過）
    if (dto.action === 'performance-diagnosis' && user?.sub) {
      await this.geminiFeedbackService.saveDiagnosis(
        user.sub,
        result.feedback,
        result.model,
        dto.interfaceLanguage,
      );
    }
    return result;
  }

  @Get('latest-diagnosis')
  getLatestDiagnosis(@CurrentUser() user: JwtPayload) {
    return this.geminiFeedbackService.getLatestDiagnosis(user.sub);
  }
}
