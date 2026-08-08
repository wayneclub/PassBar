import { GeminiFeedbackService } from './gemini-feedback.service';

function makeService(config: Record<string, string>) {
  const fakeConfig = { get: (k: string) => config[k] };
  return new (GeminiFeedbackService as any)(fakeConfig, null) as GeminiFeedbackService;
}

// getApiKeys / shouldTryNextKey 是 private —— 用 bracket 存取測其行為（可靠性關鍵路徑）。
const keysOf = (svc: GeminiFeedbackService) => (svc as any).getApiKeys() as string[];
const tryNext = (svc: GeminiFeedbackService, err: unknown) =>
  (svc as any).shouldTryNextKey(err) as boolean;

describe('GeminiFeedbackService key pool', () => {
  it('reads GEMINI_API_KEY_1..N as an ordered pool', () => {
    const svc = makeService({
      GEMINI_API_KEY_1: 'a',
      GEMINI_API_KEY_2: 'b',
      GEMINI_API_KEY_3: 'c',
    });
    expect(keysOf(svc)).toEqual(['a', 'b', 'c']);
  });

  it('falls back to the single GEMINI_API_KEY when no pool is set', () => {
    expect(keysOf(makeService({ GEMINI_API_KEY: 'solo' }))).toEqual(['solo']);
    expect(keysOf(makeService({ GOOGLE_GENAI_API_KEY: 'g' }))).toEqual(['g']);
  });

  it('returns [] when no key is configured', () => {
    expect(keysOf(makeService({}))).toEqual([]);
  });

  it('prefers the pool over the single key', () => {
    const svc = makeService({ GEMINI_API_KEY: 'solo', GEMINI_API_KEY_1: 'a' });
    expect(keysOf(svc)).toEqual(['a']);
  });
});

describe('GeminiFeedbackService.shouldTryNextKey', () => {
  const svc = makeService({ GEMINI_API_KEY_1: 'a' });

  it('rotates on transient key-level statuses (429/500/502/503/404)', () => {
    for (const status of [429, 500, 502, 503, 404]) {
      expect(tryNext(svc, { status })).toBe(true);
    }
  });

  it('rotates on a 400 that indicates an invalid API key', () => {
    expect(tryNext(svc, { status: 400, message: 'API key not valid. Please pass a valid API key.' })).toBe(true);
  });

  it('does NOT rotate on a generic 400 (bad request)', () => {
    expect(tryNext(svc, { status: 400, message: 'Invalid JSON payload' })).toBe(false);
  });

  it('does NOT rotate on a model hang (TimeoutError) — switch model instead', () => {
    const e = new Error('timeout');
    e.name = 'TimeoutError';
    expect(tryNext(svc, e)).toBe(false);
  });

  it('does NOT rotate when there is no status', () => {
    expect(tryNext(svc, new Error('network blip'))).toBe(false);
  });
});
