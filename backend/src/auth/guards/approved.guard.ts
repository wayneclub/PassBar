import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { JwtPayload } from '../strategies/jwt.strategy';

@Injectable()
export class ApprovedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as JwtPayload | undefined;

    if (!user || user.status !== 'approved') {
      throw new ForbiddenException(
        'Your membership is pending approval or has been suspended/rejected.',
      );
    }

    return true;
  }
}
