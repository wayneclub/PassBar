/**
 * Static Chinese translations for MBE subjects and chapters.
 * Keys are the English names as stored in the DB / smart-planner.
 * Used to append "(中文名稱)" when interface language is zh-TW or zh-CN.
 */

type ZhPair = { 'zh-TW': string; 'zh-CN': string };

export const SUBJECT_ZH: Record<string, ZhPair> = {
  'Civil Procedure':               { 'zh-TW': '民事訴訟法', 'zh-CN': '民事诉讼法' },
  'Constitutional Law':            { 'zh-TW': '憲法', 'zh-CN': '宪法' },
  'Contracts':                     { 'zh-TW': '合同法', 'zh-CN': '合同法' },
  'Criminal Law & Procedure':      { 'zh-TW': '刑法與刑事訴訟法', 'zh-CN': '刑法与刑事诉讼法' },
  'Criminal Law and Procedure':    { 'zh-TW': '刑法與刑事訴訟法', 'zh-CN': '刑法与刑事诉讼法' },
  'Evidence':                      { 'zh-TW': '證據法', 'zh-CN': '证据法' },
  'Real Property':                 { 'zh-TW': '不動產法', 'zh-CN': '不动产法' },
  'Torts':                         { 'zh-TW': '侵權行為法', 'zh-CN': '侵权行为法' },
};

export const CHAPTER_ZH: Record<string, ZhPair> = {
  // Civil Procedure
  'Jurisdiction and Venue':             { 'zh-TW': '管轄與地點', 'zh-CN': '管辖与地点' },
  'Law Applied by Federal Courts':      { 'zh-TW': '聯邦法院適用法律', 'zh-CN': '联邦法院适用法律' },
  'Pretrial Procedures':                { 'zh-TW': '審前程序', 'zh-CN': '审前程序' },
  'Jury Trials':                        { 'zh-TW': '陪審團審判', 'zh-CN': '陪审团审判' },
  'Motions':                            { 'zh-TW': '聲請動議', 'zh-CN': '声请动议' },
  'Verdicts and Judgments':             { 'zh-TW': '裁決與判決', 'zh-CN': '裁决与判决' },
  'Appealability and Review':           { 'zh-TW': '上訴與複審', 'zh-CN': '上诉与复审' },

  // Constitutional Law
  'Judicial Review':                    { 'zh-TW': '司法審查', 'zh-CN': '司法审查' },
  'Separation of Powers':               { 'zh-TW': '三權分立', 'zh-CN': '三权分立' },
  'Federal-State Relations':            { 'zh-TW': '聯邦與州關係', 'zh-CN': '联邦与州关系' },
  'Individual Rights':                  { 'zh-TW': '個人權利', 'zh-CN': '个人权利' },

  // Contracts
  'Formation of Contracts':             { 'zh-TW': '合同成立', 'zh-CN': '合同成立' },
  'Defenses to enforceability':         { 'zh-TW': '合同不可執行抗辯', 'zh-CN': '合同不可执行抗辩' },
  'Contract Content and Meaning':       { 'zh-TW': '合同內容與解釋', 'zh-CN': '合同内容与解释' },
  'Performance, Breach, and Discharge': { 'zh-TW': '履行、違約與解除', 'zh-CN': '履行、违约与解除' },
  'Remedies':                           { 'zh-TW': '救濟方式', 'zh-CN': '救济方式' },
  'Third-Party Rights':                 { 'zh-TW': '第三方權利', 'zh-CN': '第三方权利' },

  // Criminal Law & Procedure
  'Homicide':                           { 'zh-TW': '殺人罪', 'zh-CN': '杀人罪' },
  'Other Crimes':                       { 'zh-TW': '其他罪行', 'zh-CN': '其他罪行' },
  'Inchoate Crimes':                    { 'zh-TW': '未遂犯罪', 'zh-CN': '未遂犯罪' },
  'Constitutional Protections':         { 'zh-TW': '憲法保護', 'zh-CN': '宪法保护' },
  'Criminal Trial':                     { 'zh-TW': '刑事審判', 'zh-CN': '刑事审判' },
  'General Principles':                 { 'zh-TW': '一般原則', 'zh-CN': '一般原则' },

  // Evidence
  'Relevancy':                          { 'zh-TW': '關聯性', 'zh-CN': '关联性' },
  'Privileges and Policy':              { 'zh-TW': '特權與政策', 'zh-CN': '特权与政策' },
  'Witnesses':                          { 'zh-TW': '證人', 'zh-CN': '证人' },
  'Hearsay':                            { 'zh-TW': '傳聞證據', 'zh-CN': '传闻证据' },

  // Real Property
  'Ownership of Real Property':         { 'zh-TW': '不動產所有權', 'zh-CN': '不动产所有权' },
  'Rights in Real Property':            { 'zh-TW': '不動產權利', 'zh-CN': '不动产权利' },
  'Real Estate Contracts':              { 'zh-TW': '不動產合約', 'zh-CN': '不动产合约' },
  'Mortgages and Finance':              { 'zh-TW': '抵押與融資', 'zh-CN': '抵押与融资' },
  'Titles':                             { 'zh-TW': '產權', 'zh-CN': '产权' },

  // Torts
  'Intentional Torts':                  { 'zh-TW': '故意侵權', 'zh-CN': '故意侵权' },
  'Negligence':                         { 'zh-TW': '過失侵權', 'zh-CN': '过失侵权' },
  'Strict Liability':                   { 'zh-TW': '嚴格責任', 'zh-CN': '严格责任' },
  'Products Liability':                 { 'zh-TW': '產品責任', 'zh-CN': '产品责任' },
  'Other Torts':                        { 'zh-TW': '其他侵權', 'zh-CN': '其他侵权' },
};

/**
 * Returns the English name. If language is zh-TW or zh-CN and a translation
 * exists, appends "(中文名稱)" in parentheses.
 */
export function localizeLabel(
  englishName: string,
  language: string,
  map: Record<string, ZhPair>,
): string {
  if (language !== 'zh-TW' && language !== 'zh-CN') return englishName;
  const lang = language as 'zh-TW' | 'zh-CN';
  const zh = map[englishName]?.[lang];
  if (!zh) return englishName;
  return `${englishName}（${zh}）`;
}
