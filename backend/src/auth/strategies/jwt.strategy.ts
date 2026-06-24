import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { Strategy } from 'passport-jwt';

export type JwtPayload = {
  sub: string;
  email: string | null;
  name: string | null;
  role: string;
  status: string;
};

/** Shape of tokens issued by auth-service (auth.wayneclub.com), shared via JWT_SECRET. */
type AuthServiceMembership = {
  product: string;
  role: 'member' | 'admin' | 'owner';
  status: string;
};

type AuthServiceJwtPayload = {
  sub: string;
  sid: string;
  email: string | null;
  name: string | null;
  memberships: AuthServiceMembership[];
};

const ROLE_MAP: Record<AuthServiceMembership['role'], string> = {
  member: 'student',
  admin: 'admin',
  owner: 'admin',
};

function cookieExtractor(req: Request): string | null {
  return req?.cookies?.['access_token'] ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: cookieExtractor,
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  validate(payload: AuthServiceJwtPayload): JwtPayload {
    const membership = payload.memberships?.find(
      (m) => m.product === 'passbar',
    );
    if (!membership) {
      throw new UnauthorizedException();
    }

    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      role: ROLE_MAP[membership.role],
      status: membership.status,
    };
  }
}
