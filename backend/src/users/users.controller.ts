import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { UsersService } from './users.service';
import { UpdateStudySettingsDto } from './dto/update-study-settings.dto';
import { UpdateExamDateDto } from './dto/update-exam-date.dto';
import { UpdateDisplayNameDto } from './dto/update-display-name.dto';

@Controller('users/me')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  async getMe(@CurrentUser() user: JwtPayload) {
    return this.authService.ensureProfile(
      user.sub,
      user.email,
      user.role,
      user.status,
    );
  }

  @Patch('study-settings')
  async updateStudySettings(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateStudySettingsDto,
  ) {
    const ok = await this.usersService.saveStudySettings(
      user.sub,
      dto.studySettings,
    );
    return { ok };
  }

  @Patch('exam-date')
  async updateExamDate(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateExamDateDto,
  ) {
    const ok = await this.usersService.updateExamDate(
      user.sub,
      dto.examDate ?? null,
    );
    return { ok };
  }

  @Patch('display-name')
  async updateDisplayName(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateDisplayNameDto,
  ) {
    const ok = await this.usersService.updateDisplayName(
      user.sub,
      dto.fullName,
    );
    return { ok };
  }
}
