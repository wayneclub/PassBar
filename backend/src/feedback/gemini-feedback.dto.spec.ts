import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GeminiFeedbackRequestDto } from './gemini-feedback.service';

// main.ts 的全域 ValidationPipe 開了 whitelist: true。DTO 欄位若缺 class-validator
// decorator 會被整個剝掉——曾導致 gemini-feedback 收到空 body，action/performanceStats/
// interfaceLanguage 全部遺失。這裡用 validate(..., { whitelist: true }) 重現同一機制，
// 確保每個欄位都有 decorator、能存活。
describe('GeminiFeedbackRequestDto whitelist survival', () => {
  it('keeps all performance-diagnosis fields through whitelist validation', async () => {
    const dto = plainToInstance(GeminiFeedbackRequestDto, {
      action: 'performance-diagnosis',
      interfaceLanguage: 'zh-Hant',
      performanceStats: {
        totalAttempts: 10,
        correctAttempts: 7,
        avgTimeSeconds: 90,
        weakConcepts: [],
        errorTypeBreakdown: { careless: 2 },
        recentTrend: [60, 70],
        streakDays: 3,
      },
    });

    const errors = await validate(dto, { whitelist: true });

    expect(errors).toHaveLength(0);
    expect(dto.action).toBe('performance-diagnosis');
    expect(dto.interfaceLanguage).toBe('zh-Hant');
    expect(dto.performanceStats?.totalAttempts).toBe(10);
  });

  it('keeps question-analysis fields through whitelist validation', async () => {
    const dto = plainToInstance(GeminiFeedbackRequestDto, {
      action: 'question-analysis',
      interfaceLanguage: 'zh-Hans',
      questionText: 'Q',
      options: [{ key: 'A', text: 'a' }],
      selectedChoice: 'A',
      correctChoice: 'B',
      isCorrect: false,
      explanationText: 'because',
      topic: 'Torts',
    });

    const errors = await validate(dto, { whitelist: true });

    expect(errors).toHaveLength(0);
    expect(dto.action).toBe('question-analysis');
    expect(dto.options).toEqual([{ key: 'A', text: 'a' }]);
    expect(dto.selectedChoice).toBe('A');
    expect(dto.topic).toBe('Torts');
  });

  it('rejects an unknown action value', async () => {
    const dto = plainToInstance(GeminiFeedbackRequestDto, { action: 'hack' });
    const errors = await validate(dto, { whitelist: true });
    expect(errors.length).toBeGreaterThan(0);
  });
});
