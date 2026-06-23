import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { AuthService } from '../auth/auth.service';
import { TodosService } from './todos.service';
import { AddChapterAsTodoDto, CreateTodoDto, UpdateTodoDto } from './dto/todo.dto';

@Controller('todos')
export class TodosController {
  constructor(
    private readonly todosService: TodosService,
    private readonly authService: AuthService,
  ) {}

  /**
   * Consumed by calendar apps (Google Calendar, Apple Calendar) subscribing to the
   * user's .ics feed URL, which carries no cookie/JWT. Identity is proven via a
   * long-lived opaque "calendar" purpose token (minted at GET /auth/calendar-token)
   * instead of a raw, guessable userId — the feed URL itself is the bearer secret.
   */
  @Get('calendar-feed')
  listForCalendarFeed(@Query('token') token?: string) {
    if (!token) return [];
    const userId = this.authService.verifyCalendarToken(token);
    if (!userId) return [];
    return this.todosService.list(userId);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  list(@CurrentUser() user: JwtPayload) {
    return this.todosService.list(user.sub);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateTodoDto) {
    return this.todosService.create(user.sub, dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateTodoDto) {
    return this.todosService.update(user.sub, id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  delete(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.todosService.delete(user.sub, id);
  }

  @Post('sync-auto')
  @UseGuards(JwtAuthGuard)
  syncAuto(@CurrentUser() user: JwtPayload) {
    return this.todosService.syncAutoTodos(user.sub);
  }

  @Post('add-chapter')
  @UseGuards(JwtAuthGuard)
  addChapterAsTodo(@CurrentUser() user: JwtPayload, @Body() dto: AddChapterAsTodoDto) {
    return this.todosService.addChapterAsTodo(user.sub, dto);
  }
}
