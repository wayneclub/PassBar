import { PlannerService } from './planner.service';

// 這些方法是純計算（不碰 this.db / 其他 service），可直接 new 出來測。
const planner = new (PlannerService as any)(null, null, null, null, null) as PlannerService;

function isoDaysFromToday(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('PlannerService.calculateDailyQuota', () => {
  const everyDay = [0, 1, 2, 3, 4, 5, 6];

  it('no exam date → quota 0, not triage', () => {
    const q = planner.calculateDailyQuota(1000, 0, null, everyDay, 2);
    expect(q.quota).toBe(0);
    expect(q.triageMode).toBe(false);
  });

  it('exam far in the future → positive quota, not triage, split is consistent', () => {
    const q = planner.calculateDailyQuota(1000, 0, isoDaysFromToday(200), everyDay, 2);
    expect(q.quota).toBeGreaterThan(0);
    expect(q.triageMode).toBe(false);
    expect(q.newQuota + q.reviewQuota).toBe(q.quota);
  });

  it('exam already passed → triage mode, all remaining in one go', () => {
    const q = planner.calculateDailyQuota(1000, 200, isoDaysFromToday(-1), everyDay, 2);
    expect(q.triageMode).toBe(true);
    expect(q.quota).toBe(800); // 1000 - 200 practiced
  });

  it('exam within the triage window → triage mode with positive quota', () => {
    const q = planner.calculateDailyQuota(1000, 0, isoDaysFromToday(7), everyDay, 2);
    expect(q.triageMode).toBe(true);
    expect(q.quota).toBeGreaterThan(0);
  });

  it('daily study hours caps the quota (timeCapped)', () => {
    const uncapped = planner.calculateDailyQuota(5000, 0, isoDaysFromToday(30), everyDay, 2);
    const capped = planner.calculateDailyQuota(5000, 0, isoDaysFromToday(30), everyDay, 2, 0.25);
    expect(capped.quota).toBeLessThanOrEqual(uncapped.quota);
    expect(capped.timeCapped).toBe(true);
  });
});

describe('PlannerService.assessQuestionMastery (spaced repetition)', () => {
  const now = new Date('2026-01-20T12:00:00');
  const correct = (day: string) => ({ isCorrect: true, answeredAt: `${day}T10:00:00` });

  it('no attempts → default unmastered / not due / interval 1', () => {
    const a = planner.assessQuestionMastery([], now);
    expect(a).toMatchObject({ mastered: false, due: false, intervalDays: 1, reliableCorrectStreak: 0 });
  });

  it('3 reliable correct across 3 distinct recent days → mastered, not yet due (interval 7)', () => {
    const a = planner.assessQuestionMastery(
      [correct('2026-01-17'), correct('2026-01-18'), correct('2026-01-19')],
      now,
    );
    expect(a.distinctReliableDays).toBe(3);
    expect(a.intervalDays).toBe(7);
    expect(a.mastered).toBe(true);
    expect(a.due).toBe(false); // last attempt 1 day ago < 7
  });

  it('mastered but last practiced long ago → due', () => {
    const a = planner.assessQuestionMastery(
      [correct('2026-01-01'), correct('2026-01-02'), correct('2026-01-03')],
      now,
    );
    expect(a.mastered).toBe(true);
    expect(a.due).toBe(true); // 17 days since last, interval 7
  });

  it('a recent wrong answer → not mastered, flagged everIncorrect, interval resets to 1', () => {
    const a = planner.assessQuestionMastery(
      [{ isCorrect: false, answeredAt: '2026-01-18T10:00:00' }],
      now,
    );
    expect(a.mastered).toBe(false);
    expect(a.everIncorrect).toBe(true);
    expect(a.intervalDays).toBe(1);
    expect(a.due).toBe(true); // 2 days since, interval 1
  });
});
