import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 直接解析 i18n.ts 原始碼（它是 client component、含 React import，無法在 node 直接 import），
// 抽出三個語系字典的 key 集合並比對，抓「某語系漏翻譯」這類最常見的 i18n 回歸。
const src = readFileSync(new URL('./i18n.ts', import.meta.url), 'utf8');

function keysOfBlock(startMarker, endIndex) {
  const start = src.indexOf(startMarker);
  assert.ok(start !== -1, `找不到字典區塊: ${startMarker}`);
  const block = src.slice(start, endIndex);
  const keys = new Set();
  const re = /^\s{2,}'([^']+)':/gm; // 縮排的 'key': 定義（值在同行，不會誤抓）
  let m;
  while ((m = re.exec(block)) !== null) keys.add(m[1]);
  return keys;
}

const idxHans = src.indexOf('const zhHans: Dictionary = {');
const idxHant = src.indexOf('const zhHant: Dictionary = {');
const hantEnd = src.indexOf('\n};', idxHant);

const en = keysOfBlock('const en: Dictionary = {', idxHans);
const zhHans = keysOfBlock('const zhHans: Dictionary = {', idxHant);
const zhHant = keysOfBlock('const zhHant: Dictionary = {', hantEnd);

const diff = (a, b) => [...a].filter((k) => !b.has(k));

test('each language dictionary has a non-trivial number of keys', () => {
  assert.ok(en.size > 100, `en keys too few: ${en.size}`);
  assert.ok(zhHans.size > 100, `zh-Hans keys too few: ${zhHans.size}`);
  assert.ok(zhHant.size > 100, `zh-Hant keys too few: ${zhHant.size}`);
});

test('zh-Hans covers exactly the same keys as en', () => {
  assert.deepEqual(diff(en, zhHans), [], `keys missing in zh-Hans: ${diff(en, zhHans).join(', ')}`);
  assert.deepEqual(diff(zhHans, en), [], `extra keys in zh-Hans: ${diff(zhHans, en).join(', ')}`);
});

test('zh-Hant covers exactly the same keys as en', () => {
  assert.deepEqual(diff(en, zhHant), [], `keys missing in zh-Hant: ${diff(en, zhHant).join(', ')}`);
  assert.deepEqual(diff(zhHant, en), [], `extra keys in zh-Hant: ${diff(zhHant, en).join(', ')}`);
});
