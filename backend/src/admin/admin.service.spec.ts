import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  const db = {} as ConstructorParameters<typeof AdminService>[0];
  const config = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'AUTH_SERVICE_URL') return 'https://auth.example.com/base';
      if (key === 'SERVICE_SECRET') return 'service-secret';
      throw new Error(`Unexpected config key: ${key}`);
    }),
  } as unknown as ConfigService;

  let service: AdminService;

  beforeEach(() => {
    service = new AdminService(db, config);
    jest.restoreAllMocks();
  });

  it('loads login history with encoded parameters and service authorization', async () => {
    const payload = {
      sessions: [
        {
          id: 'session-1',
          createdAt: '2026-06-24T00:00:00.000Z',
          lastUsedAt: null,
          revokedAt: null,
          ip: '127.0.0.1',
          userAgent: 'test',
        },
      ],
      loginCount: 1,
    };
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(payload), { status: 200 }),
      );

    await expect(
      service.getLoginHistory('user+filter@example.com&limit=999', 25),
    ).resolves.toEqual(payload);

    const [url, options] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.origin).toBe('https://auth.example.com');
    expect(parsed.pathname).toBe('/auth/internal/sessions');
    expect(parsed.searchParams.get('userId')).toBe(
      'user+filter@example.com&limit=999',
    );
    expect(parsed.searchParams.get('limit')).toBe('25');
    expect(options).toEqual({
      headers: { Authorization: 'Bearer service-secret' },
    });
  });

  it.each([
    [0, '1'],
    [-10, '1'],
    [999, '100'],
    [Number.NaN, '20'],
  ])('normalizes login history limit %p to %s', async (limit, expected) => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ sessions: [], loginCount: 0 }), {
        status: 200,
      }),
    );

    await service.getLoginHistory('user-id', limit);

    const [url] = fetchMock.mock.calls[0];
    expect(new URL(String(url)).searchParams.get('limit')).toBe(expected);
  });

  it('turns an auth-service failure into an internal server error', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 503 }));

    await expect(service.getLoginHistory('user-id')).rejects.toEqual(
      new InternalServerErrorException(
        'auth-service rejected login history lookup (503)',
      ),
    );
  });
});
