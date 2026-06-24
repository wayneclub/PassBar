/**
 * Selects a proportional, non-duplicated set of question IDs by subject.
 *
 * @param {Map<string, string[]>} questionsBySubject
 * @param {number} requestedCount
 * @param {() => number} [random]
 * @returns {Array<{id: string, subject: string}>}
 */
export function selectSimExamQuestions(
  questionsBySubject,
  requestedCount,
  random = Math.random,
) {
  const seenIds = new Set();
  const entries = [];

  for (const [subject, questionIds] of questionsBySubject) {
    const uniqueIds = [];
    for (const id of questionIds) {
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      uniqueIds.push(id);
    }
    if (uniqueIds.length > 0) entries.push({ subject, ids: uniqueIds });
  }

  const availableCount = entries.reduce((sum, entry) => sum + entry.ids.length, 0);
  const targetCount = Math.min(
    Math.max(0, Math.trunc(requestedCount)),
    availableCount,
  );
  if (targetCount === 0) return [];

  const allocations = entries.map((entry) => {
    const exactQuota = (entry.ids.length / availableCount) * targetCount;
    return {
      ...entry,
      exactQuota,
      quota: Math.floor(exactQuota),
    };
  });

  let remaining =
    targetCount - allocations.reduce((sum, entry) => sum + entry.quota, 0);
  allocations.sort(
    (a, b) =>
      b.exactQuota - b.quota - (a.exactQuota - a.quota) ||
      b.ids.length - a.ids.length ||
      a.subject.localeCompare(b.subject),
  );

  for (const entry of allocations) {
    if (remaining === 0) break;
    if (entry.quota < entry.ids.length) {
      entry.quota += 1;
      remaining -= 1;
    }
  }

  const selected = allocations.flatMap((entry) =>
    shuffled(entry.ids, random)
      .slice(0, entry.quota)
      .map((id) => ({ id, subject: entry.subject })),
  );

  return shuffled(selected, random);
}

/**
 * @template T
 * @param {T[]} values
 * @param {() => number} random
 * @returns {T[]}
 */
function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}
