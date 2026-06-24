import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { AdminService } from './admin.service';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  listUsers() {
    return this.adminService.listUsers();
  }

  @Patch('users/:id/status')
  updateUserStatus(@Param('id') id: string, @Body() dto: UpdateUserStatusDto) {
    return this.adminService.updateUserStatus(id, dto.status);
  }

  @Get('users/:id/login-history')
  getLoginHistory(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.adminService.getLoginHistory(id, Number(limit) || 20);
  }

  @Get('dashboard-summary')
  getDashboardSummary(@Query('sinceDays') sinceDays?: string) {
    return this.adminService.getDashboardSummary(Number(sinceDays) || 7);
  }

  @Get('pending-users')
  getPendingUsers(@Query('limit') limit?: string) {
    return this.adminService.getPendingUsers(Number(limit) || 5);
  }
}
