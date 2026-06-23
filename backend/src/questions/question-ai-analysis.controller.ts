import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { QuestionAiAnalysisService } from './question-ai-analysis.service';
import { GetCachedAnalysisDto, SaveAnalysisDto } from './dto/question-ai-analysis.dto';

@Controller('question-ai-analysis')
@UseGuards(JwtAuthGuard)
export class QuestionAiAnalysisController {
  constructor(private readonly aiAnalysisService: QuestionAiAnalysisService) {}

  @Post('cached')
  async getCached(@Body() dto: GetCachedAnalysisDto) {
    const analysisMarkdown = await this.aiAnalysisService.getCached(dto);
    return { analysisMarkdown };
  }

  @Post()
  save(@Body() dto: SaveAnalysisDto) {
    return this.aiAnalysisService.save(dto);
  }
}
