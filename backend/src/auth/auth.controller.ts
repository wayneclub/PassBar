import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from './strategies/jwt.strategy';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: JwtPayload) {
    return this.authService.ensureProfile(user.sub, user.email, user.role, user.status);
  }

  @Get('calendar-token')
  @UseGuards(JwtAuthGuard)
  getCalendarToken(@CurrentUser() user: JwtPayload) {
    return { token: this.authService.issueCalendarToken(user.sub) };
  }
}
