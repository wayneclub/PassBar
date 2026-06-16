import OpenCC from 'opencc-js';

import type { InterfaceLanguage } from './study-settings';

const simplifiedToTaiwanTraditional = OpenCC.Converter({ from: 'cn', to: 'twp' });

export function shouldUseTraditionalChinese(language: InterfaceLanguage | string | undefined) {
  return language === 'zh-Hant';
}

export function toTraditionalChinese(value: string) {
  return simplifiedToTaiwanTraditional(value);
}

export function toTraditionalChineseIfNeeded(
  value: string,
  language: InterfaceLanguage | string | undefined,
) {
  return shouldUseTraditionalChinese(language) ? toTraditionalChinese(value) : value;
}

export function toTraditionalChineseListIfNeeded(
  values: string[],
  language: InterfaceLanguage | string | undefined,
) {
  return shouldUseTraditionalChinese(language) ? values.map(toTraditionalChinese) : values;
}
