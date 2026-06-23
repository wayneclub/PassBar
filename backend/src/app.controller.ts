import { Controller, Get, Inject } from '@nestjs/common';
import { AppService } from './app.service';
import { DB, type Database } from './db/db.provider';
import { profiles } from './db/schema';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    @Inject(DB) private readonly db: Database,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health/db')
  async healthDb() {
    await this.db.select().from(profiles).limit(1);
    return { ok: true };
  }
}
