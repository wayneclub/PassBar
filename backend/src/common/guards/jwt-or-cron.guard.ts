import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtOrCronGuard extends AuthGuard('jwt') {
  constructor(private readonly configService: ConfigService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Check Cron Secret
    const secret = this.configService.get<string>('CRON_SECRET');
    const req = context.switchToHttp().getRequest();
    const header = req.headers['authorization'];
    if (secret && header === `Bearer ${secret}`) {
      return true;
    }

    // 2. Fallback to JWT authentication
    try {
      const result = await super.canActivate(context);
      return Boolean(result);
    } catch {
      return false;
    }
  }
}
