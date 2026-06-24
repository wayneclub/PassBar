import type { Question } from './types';
import { savePracticeAnswer } from './practice-sessions';
import { saveQuestionAnswerProgress } from './question-progress';

const DB_NAME = 'passbar-offline';
const DB_VERSION = 1;
const QUESTION_SNAPSHOTS_STORE = 'questionSnapshots';
const PENDING_ANSWERS_STORE = 'pendingAnswers';

type QuestionSnapshotRecord = {
  sessionId: string;
  questions: Question[];
  savedAt: number;
};

export type PendingAnswerSync = {
  id?: number;
  sessionId: string;
  userId: string;
  questionId: string;
  selectedChoice: string;
  correctAnswer: string;
  isCorrect: boolean;
  timeSpentSeconds?: number;
  progressSynced?: boolean;
  answerSynced?: boolean;
  createdAt: number;
};

function canUseIndexedDb() {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function openOfflineDb(): Promise<IDBDatabase | null> {
  if (!canUseIndexedDb()) return Promise.resolve(null);

  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(QUESTION_SNAPSHOTS_STORE)) {
        db.createObjectStore(QUESTION_SNAPSHOTS_STORE, { keyPath: 'sessionId' });
      }
      if (!db.objectStoreNames.contains(PENDING_ANSWERS_STORE)) {
        const store = db.createObjectStore(PENDING_ANSWERS_STORE, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('createdAt', 'createdAt');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.warn('[PassBar] Unable to open offline cache:', request.error?.message);
      resolve(null);
    };
  });
}

function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openOfflineDb().then((db) => {
    if (!db) return null;

    return new Promise<T | null>((resolve) => {
      const transaction = db.transaction(storeName, mode);
      const request = callback(transaction.objectStore(storeName));

      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => {
        console.warn('[PassBar] Offline cache operation failed:', request.error?.message);
        resolve(null);
      };
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => db.close();
      transaction.onabort = () => db.close();
    });
  });
}

export async function saveTestQuestionSnapshot(sessionId: string, questions: Question[]) {
  if (!sessionId || questions.length === 0) return;

  await withStore<IDBValidKey>(QUESTION_SNAPSHOTS_STORE, 'readwrite', (store) => (
    store.put({ sessionId, questions, savedAt: Date.now() })
  ));
}

export async function getTestQuestionSnapshot(sessionId: string): Promise<Question[] | null> {
  if (!sessionId) return null;

  const record = await withStore<QuestionSnapshotRecord>(QUESTION_SNAPSHOTS_STORE, 'readonly', (store) => (
    store.get(sessionId)
  ));

  return record?.questions ?? null;
}

export async function deleteTestQuestionSnapshot(sessionId: string) {
  if (!sessionId) return;

  await withStore<undefined>(QUESTION_SNAPSHOTS_STORE, 'readwrite', (store) => (
    store.delete(sessionId)
  ));
}

export async function addPendingAnswerSync(input: Omit<PendingAnswerSync, 'id' | 'createdAt'>) {
  await withStore<IDBValidKey>(PENDING_ANSWERS_STORE, 'readwrite', (store) => (
    store.add({ ...input, createdAt: Date.now() })
  ));
}

async function getPendingAnswerSyncItems(): Promise<PendingAnswerSync[]> {
  const items = await withStore<PendingAnswerSync[]>(PENDING_ANSWERS_STORE, 'readonly', (store) => (
    store.getAll()
  ));
  return items ?? [];
}

export async function deletePendingAnswerSyncItemsForSession(sessionId: string) {
  if (!sessionId) return;

  const items = await getPendingAnswerSyncItems();
  await removePendingAnswerSyncItems(
    items
      .filter((item) => item.sessionId === sessionId && item.id)
      .map((item) => item.id!),
  );
}

async function removePendingAnswerSyncItems(ids: number[]) {
  if (ids.length === 0) return;

  const db = await openOfflineDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    const transaction = db.transaction(PENDING_ANSWERS_STORE, 'readwrite');
    const store = transaction.objectStore(PENDING_ANSWERS_STORE);
    ids.forEach((id) => store.delete(id));
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      console.warn('[PassBar] Unable to clear synced offline answers:', transaction.error?.message);
      db.close();
      resolve();
    };
    transaction.onabort = () => {
      db.close();
      resolve();
    };
  });
}

async function updatePendingAnswerSyncItem(item: PendingAnswerSync) {
  if (!item.id) return;

  await withStore<IDBValidKey>(PENDING_ANSWERS_STORE, 'readwrite', (store) => (
    store.put(item)
  ));
}

export async function syncPendingAnswerProgress() {
  const items = await getPendingAnswerSyncItems();
  const syncedIds: number[] = [];

  for (const item of items) {
    const progressSaved = item.progressSynced || await saveQuestionAnswerProgress({
        userId: item.userId,
        questionId: item.questionId,
        selectedChoice: item.selectedChoice,
        timeSpentSeconds: item.timeSpentSeconds,
      });
    const answerSaved = item.answerSynced || await savePracticeAnswer({
        sessionId: item.sessionId,
        userId: item.userId,
        questionId: item.questionId,
        selectedChoice: item.selectedChoice,
        timeSpentSeconds: item.timeSpentSeconds,
      });

    if (progressSaved && answerSaved && item.id) syncedIds.push(item.id);
    else await updatePendingAnswerSyncItem({ ...item, progressSynced: progressSaved, answerSynced: answerSaved });
  }

  await removePendingAnswerSyncItems(syncedIds);
}
