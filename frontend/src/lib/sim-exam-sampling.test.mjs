import assert from 'node:assert/strict';
import test from 'node:test';
import { selectSimExamQuestions } from './sim-exam-sampling.mjs';

const ids = (prefix, count) =>
  Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`);

test('selects the requested count with proportional subject allocation', () => {
  const selected = selectSimExamQuestions(
    new Map([
      ['Contracts', ids('contracts', 60)],
      ['Torts', ids('torts', 30)],
      ['Evidence', ids('evidence', 10)],
    ]),
    50,
    () => 0.5,
  );

  assert.equal(selected.length, 50);
  assert.equal(new Set(selected.map((question) => question.id)).size, 50);

  const counts = Object.fromEntries(
    ['Contracts', 'Torts', 'Evidence'].map((subject) => [
      subject,
      selected.filter((question) => question.subject === subject).length,
    ]),
  );
  assert.deepEqual(counts, { Contracts: 30, Torts: 15, Evidence: 5 });
});

test('returns the full pool when fewer questions exist than requested', () => {
  const selected = selectSimExamQuestions(
    new Map([
      ['Contracts', ['c-1', 'c-2']],
      ['Torts', ['t-1']],
    ]),
    100,
  );

  assert.equal(selected.length, 3);
  assert.deepEqual(
    new Set(selected.map((question) => question.id)),
    new Set(['c-1', 'c-2', 't-1']),
  );
});

test('deduplicates question IDs across subjects', () => {
  const selected = selectSimExamQuestions(
    new Map([
      ['Contracts', ['shared', 'c-1']],
      ['Torts', ['shared', 't-1']],
    ]),
    10,
  );

  assert.equal(selected.length, 3);
  assert.equal(selected.filter((question) => question.id === 'shared').length, 1);
});

test('handles an empty pool and invalid requested count', () => {
  assert.deepEqual(selectSimExamQuestions(new Map(), 100), []);
  assert.deepEqual(
    selectSimExamQuestions(new Map([['Contracts', ['c-1']]]), Number.NaN),
    [],
  );
});
