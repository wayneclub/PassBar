import { buildProjection, type ProjectionInput } from './planner.service';

function daysFromNow(base: Date, n: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

function makeStat(overrides: Partial<ProjectionInput['chapterStats'][number]> = {}) {
  return {
    chapterId: 'ch1',
    chapterName: 'Hearsay',
    subject: 'Evidence',
    attempts: 4,
    correct: 1, // 25% accuracy → weak → interval 1
    lastAttemptAt: '',
    totalAttempts: 4,
    lastAccuracy: 25,
    ...overrides,
  } as ProjectionInput['chapterStats'][number];
}

describe('buildProjection', () => {
  const today = new Date(2026, 0, 5); // fixed date, all-day study week keeps it deterministic
  const everyDay = [0, 1, 2, 3, 4, 5, 6];

  it('returns [] when there is no exam date', () => {
    const out = buildProjection({
      today,
      examDate: null,
      studyDaysPerWeek: everyDay,
      chapterStats: [makeStat({ lastAttemptAt: daysFromNow(today, -2).toISOString() })],
      allChapters: [],
      newChaptersPerStudyDay: 2,
    });
    expect(out).toEqual([]);
  });

  it('returns [] when the exam date is not in the future', () => {
    const out = buildProjection({
      today,
      examDate: daysFromNow(today, -1),
      studyDaysPerWeek: everyDay,
      chapterStats: [makeStat({ lastAttemptAt: daysFromNow(today, -2).toISOString() })],
      allChapters: [],
      newChaptersPerStudyDay: 2,
    });
    expect(out).toEqual([]);
  });

  it('projects spaced-repetition reviews within [today, exam] with increasing occurrence/stage', () => {
    const exam = daysFromNow(today, 20);
    const out = buildProjection({
      today,
      examDate: exam,
      studyDaysPerWeek: everyDay,
      chapterStats: [makeStat({ lastAttemptAt: daysFromNow(today, -2).toISOString() })],
      allChapters: [],
      newChaptersPerStudyDay: 0,
    });

    const reviews = out.flatMap((d) =>
      d.entries.filter((e) => e.chapterId === 'ch1').map((e) => ({ date: d.date, ...e })),
    );
    expect(reviews.length).toBeGreaterThan(0);
    // every review is a review, within horizon, occurrence 0,1,2..., stage non-decreasing
    reviews.forEach((r, i) => {
      expect(r.type).toBe('review');
      expect(r.occurrence).toBe(i);
      expect(r.date >= '2026-01-05').toBe(true);
      expect(r.date <= '2026-01-25').toBe(true);
      if (i > 0) expect(r.stage).toBeGreaterThanOrEqual(reviews[i - 1].stage);
    });
  });

  it('distributes unstudied chapters as practice, capped per study day', () => {
    const exam = daysFromNow(today, 10);
    const allChapters = Array.from({ length: 9 }, (_, i) => ({
      id: `new${i}`,
      name: `Chapter ${i}`,
      subject: 'Torts',
    }));
    const out = buildProjection({
      today,
      examDate: exam,
      studyDaysPerWeek: everyDay,
      chapterStats: [], // nothing studied → all 9 are new
      allChapters,
      newChaptersPerStudyDay: 3,
    });

    const practice = out.flatMap((d) => d.entries.filter((e) => e.type === 'practice'));
    expect(practice.length).toBe(9); // all backlog scheduled
    // no day exceeds the cap of 3 practice entries
    out.forEach((d) => {
      const n = d.entries.filter((e) => e.type === 'practice').length;
      expect(n).toBeLessThanOrEqual(3);
    });
    // dates are sorted ascending
    const dates = out.map((d) => d.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('excludes already-studied chapters from the new-practice backlog', () => {
    const exam = daysFromNow(today, 10);
    const out = buildProjection({
      today,
      examDate: exam,
      studyDaysPerWeek: everyDay,
      chapterStats: [makeStat({ chapterId: 'new0', lastAttemptAt: daysFromNow(today, -1).toISOString() })],
      allChapters: [
        { id: 'new0', name: 'Studied', subject: 'Torts' },
        { id: 'new1', name: 'Fresh', subject: 'Torts' },
      ],
      newChaptersPerStudyDay: 5,
    });
    const practiceIds = out.flatMap((d) => d.entries.filter((e) => e.type === 'practice').map((e) => e.chapterId));
    expect(practiceIds).toContain('new1');
    expect(practiceIds).not.toContain('new0');
  });
});
