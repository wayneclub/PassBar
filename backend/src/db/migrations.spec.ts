import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Drizzle migrations', () => {
  it('registers every SQL migration in the journal in the same order', () => {
    const migrationsDir = resolve(process.cwd(), 'drizzle/migrations');
    const sqlTags = readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .sort()
      .map((name) => name.replace(/\.sql$/, ''));
    const journal = JSON.parse(
      readFileSync(resolve(migrationsDir, 'meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> };

    expect(journal.entries.map((entry) => entry.idx)).toEqual(
      journal.entries.map((_, index) => index),
    );
    expect(journal.entries.map((entry) => entry.tag)).toEqual(sqlTags);
  });
});
