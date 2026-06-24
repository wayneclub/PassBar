import { Controller, Get, Query, Res, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { TodosService } from './todos.service';
import { AuthService } from '../auth/auth.service';

@Controller('calendar')
export class CalendarController {
  constructor(
    private readonly todosService: TodosService,
    private readonly authService: AuthService,
  ) {}

  @Get('feed')
  async getFeed(@Query('token') token: string, @Res() res: Response) {
    if (!token) {
      throw new BadRequestException('Missing token');
    }

    const userId = this.authService.verifyCalendarToken(token);
    if (!userId) {
      return this.sendIcs(
        res,
        'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//PassBar//Study Plan//EN\r\nEND:VCALENDAR\r\n',
      );
    }

    const todos = await this.todosService.list(userId);
    const ics = this.generateIcs(todos);
    return this.sendIcs(res, ics);
  }

  private sendIcs(res: Response, ics: string) {
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="passbar-plan.ics"');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.status(200).send(ics);
  }

  private formatDateIcs(date: Date) {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  }

  private formatDateIcsDateOnly(date: Date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  private escapeIcsText(text: string) {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  }

  private generateIcs(todos: any[]) {
    const now = new Date();
    const dtstamp = this.formatDateIcs(now);

    let ics = `BEGIN:VCALENDAR\r\n`;
    ics += `VERSION:2.0\r\n`;
    ics += `PRODID:-//PassBar//Study Plan//EN\r\n`;
    ics += `CALSCALE:GREGORIAN\r\n`;
    ics += `METHOD:PUBLISH\r\n`;
    ics += `X-WR-CALNAME:PassBar Study Plan\r\n`;
    ics += `X-WR-TIMEZONE:UTC\r\n`;

    for (const todo of todos) {
      if (!todo.dueDate) continue;

      const dueDate = new Date(todo.dueDate);
      const dtstart = this.formatDateIcsDateOnly(dueDate);

      const endDate = new Date(dueDate);
      endDate.setDate(endDate.getDate() + 1);
      const dtend = this.formatDateIcsDateOnly(endDate);

      ics += `BEGIN:VEVENT\r\n`;
      ics += `UID:${todo.id}@passbar.app\r\n`;
      ics += `DTSTAMP:${dtstamp}\r\n`;
      ics += `DTSTART;VALUE=DATE:${dtstart}\r\n`;
      ics += `DTEND;VALUE=DATE:${dtend}\r\n`;

      const prefix = todo.status === 'completed' ? '✅ ' : '🗓️ ';
      ics += `SUMMARY:${this.escapeIcsText(prefix + todo.title)}\r\n`;

      let description = `Type: ${todo.type}\\nStatus: ${todo.status}`;
      if (todo.chapterIds) {
        description += `\\n\\nLink: https://passbar.app/create?chapters=${encodeURIComponent(
          todo.chapterIds,
        )}`;
      }
      ics += `DESCRIPTION:${this.escapeIcsText(description)}\r\n`;

      ics += `END:VEVENT\r\n`;
    }

    ics += `END:VCALENDAR\r\n`;
    return ics;
  }
}
