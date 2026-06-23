import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Guards server-to-server cron endpoints with a shared secret header instead of
 * a user JWT cookie, since these requests have no end-user session.
 */
@Injectable()
export class CronSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.config.get<string>('CRON_SECRET');
    if (!secret) return true; // not configured — allow (matches prior Next.js route behavior)

    const req = context.switchToHttp().getRequest();
    const header = req.headers['authorization'];
    if (header !== `Bearer ${secret}`) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
