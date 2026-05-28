"use client";

import { useEffect, useMemo, useState } from 'react';
import { getStudySettings, InterfaceLanguage } from './study-settings';

type TranslationKey =
  | 'app.tagline'
  | 'nav.dashboard'
  | 'nav.openNavigation'
  | 'nav.qbank'
  | 'nav.createTest'
  | 'nav.previousTests'
  | 'nav.performance'
  | 'nav.assessments'
  | 'nav.tools'
  | 'nav.settings'
  | 'nav.tutorial'
  | 'nav.resetOptions'
  | 'nav.help'
  | 'tour.stepOf'
  | 'tour.back'
  | 'tour.next'
  | 'tour.done'
  | 'tour.qbankTitle'
  | 'tour.qbankDescription'
  | 'tour.createTestTitle'
  | 'tour.createTestDescription'
  | 'tour.testModeTitle'
  | 'tour.testModeDescription'
  | 'tour.questionModeTitle'
  | 'tour.questionModeDescription'
  | 'tour.subjectsTitle'
  | 'tour.subjectsDescription'
  | 'tour.generateTitle'
  | 'tour.generateDescription'
  | 'auth.signOut'
  | 'profile.open'
  | 'profile.details'
  | 'role.student'
  | 'settings.title'
  | 'settings.description'
  | 'settings.interfaceLanguage'
  | 'settings.interfaceLanguageDescription'
  | 'settings.english'
  | 'settings.simplifiedChinese'
  | 'settings.traditionalChinese'
  | 'settings.questionDisplay'
  | 'settings.questionDisplayDescription'
  | 'settings.englishQuestion'
  | 'settings.englishQuestionDescription'
  | 'settings.bilingualQuestion'
  | 'settings.bilingualQuestionDescription'
  | 'settings.textSize'
  | 'settings.textSizeDescription'
  | 'settings.small'
  | 'settings.medium'
  | 'settings.large'
  | 'settings.compactReading'
  | 'settings.comfortableReading'
  | 'settings.largerReading'
  | 'settings.save'
  | 'settings.saved'
  | 'settings.saving'
  | 'settings.savedDescription'
  | 'settings.saveFailed'
  | 'settings.autoSaveHint'
  | 'create.title'
  | 'create.testDate'
  | 'create.today'
  | 'create.launchTutorial'
  | 'create.testMode'
  | 'create.testModeHint'
  | 'create.tutorModeHint'
  | 'create.timedModeHint'
  | 'create.tutor'
  | 'create.timed'
  | 'create.browse'
  | 'create.browseModeHint'
  | 'create.questionMode'
  | 'create.questionModeHint'
  | 'create.standard'
  | 'create.custom'
  | 'create.unused'
  | 'create.unusedHint'
  | 'create.incorrect'
  | 'create.incorrectHint'
  | 'create.marked'
  | 'create.markedHint'
  | 'create.omitted'
  | 'create.omittedHint'
  | 'create.correct'
  | 'create.correctHint'
  | 'create.subjectsAndChapters'
  | 'create.collapseAll'
  | 'create.noOfQuestions'
  | 'create.maxAllowed'
  | 'create.generateTest'
  | 'create.generating'
  | 'create.selectChapterAlert'
  | 'create.noQuestionsAlert'
  | 'create.selectedChapters'
  | 'create.availableQuestions'
  | 'create.readyToGenerate'
  | 'create.totalQuestions'
  | 'create.practicedQuestions'
  | 'create.unpracticedQuestions'
  | 'test.submit'
  | 'test.explanation'
  | 'test.submitToViewExplanation'
  | 'test.end'
  | 'test.suspend'
  | 'test.resume'
  | 'test.feedback'
  | 'test.previous'
  | 'test.next'
  | 'test.correct'
  | 'test.incorrect'
  | 'test.correctAnswer'
  | 'test.answeredCorrectly'
  | 'test.timeSpent'
  | 'test.markQuestion'
  | 'test.unmarkQuestion'
  | 'test.questions'
  | 'test.answeredCount'
  | 'test.current'
  | 'test.answered'
  | 'test.marked'
  | 'test.unanswered'
  | 'test.aiFeedback'
  | 'test.generatingFeedback'
  | 'test.feedbackError'
  | 'test.feedbackEmpty'
  | 'test.completeTimedBeforeReview'
  | 'test.confirmEndTitle'
  | 'test.confirmEndDescription'
  | 'test.cancelEnd'
  | 'test.confirmEnd'
  | 'test.ending'
  | 'test.close'
  | 'explanation.title'
  | 'explanation.visualGuide'
  | 'explanation.image'
  | 'explanation.reviewSource'
  | 'explanation.highlight'
  | 'explanation.geminiFeedback'
  | 'explanation.geminiLoading'
  | 'explanation.geminiError'
  | 'explanation.eliminateChoice'
  | 'explanation.restoreChoice'
  | 'dashboard.welcome'
  | 'dashboard.loading'
  | 'dashboard.answered'
  | 'dashboard.ready'
  | 'dashboard.viewHistory'
  | 'dashboard.startNewSession'
  | 'dashboard.overallMastery'
  | 'dashboard.questionsSolved'
  | 'dashboard.totalQuestions'
  | 'dashboard.practiceAttempts'
  | 'dashboard.today'
  | 'dashboard.studyStreak'
  | 'dashboard.days'
  | 'dashboard.timeToday'
  | 'dashboard.remaining'
  | 'dashboard.subjectPerformance'
  | 'dashboard.subjectPerformanceDescription'
  | 'dashboard.noPerformance'
  | 'dashboard.recentInsights'
  | 'dashboard.strongInsightTitle'
  | 'dashboard.strongInsightDescription'
  | 'dashboard.reviewInsightTitle'
  | 'dashboard.reviewInsightDescription'
  | 'dashboard.noAnswers'
  | 'dashboard.noAnswersDescription'
  | 'dashboard.aiFeedbackEnabled'
  | 'dashboard.aiFeedbackEnabledDescription'
  | 'dashboard.aiFeedbackDisabled'
  | 'dashboard.aiFeedbackDisabledDescription'
  | 'dashboard.aiFeedbackUnknown'
  | 'dashboard.aiFeedbackUnknownDescription'
  | 'dashboard.nextMilestone'
  | 'dashboard.milestoneText'
  | 'dashboard.startLearning'
  | 'review.title'
  | 'review.description'
  | 'review.searchPlaceholder'
  | 'review.noSessions'
  | 'review.noSessionsDescription'
  | 'review.createFirstTest'
  | 'review.accuracy'
  | 'review.duration'
  | 'review.correct'
  | 'review.reviewQuestions'
  | 'review.mixedSubjects'
  | 'review.loading'
  | 'performance.title'
  | 'performance.description'
  | 'performance.loading'
  | 'performance.noAnswersTitle'
  | 'performance.noAnswersDescription'
  | 'performance.startPractice'
  | 'performance.overallAccuracy'
  | 'performance.correctTotal'
  | 'performance.avgTime'
  | 'performance.subjectsPracticed'
  | 'performance.subjectAccuracy'
  | 'performance.subjectAccuracyDescription'
  | 'performance.highestYieldReview'
  | 'performance.highestYieldDescription'
  | 'performance.questionsOverTime'
  | 'performance.questionsOverTimeDescription'
  | 'performance.strongChapters'
  | 'performance.strongChaptersDescription'
  | 'performance.correctCount'
  | 'performance.unknownSubject'
  | 'performance.unknownChapter';

type Dictionary = Record<TranslationKey, string>;

const en: Dictionary = {
  'app.tagline': 'Bar prep workspace',
  'nav.dashboard': 'Dashboard',
  'nav.openNavigation': 'Open navigation',
  'nav.qbank': 'QBank',
  'nav.createTest': 'Create Test',
  'nav.previousTests': 'Previous Tests',
  'nav.performance': 'Performance',
  'nav.assessments': 'Assessments',
  'nav.tools': 'Tools',
  'nav.settings': 'Settings',
  'nav.tutorial': 'Tutorial',
  'nav.resetOptions': 'Reset Options',
  'nav.help': 'Help',
  'tour.stepOf': '{current} of {total}',
  'tour.back': 'Back',
  'tour.next': 'Next',
  'tour.done': 'Done',
  'tour.qbankTitle': 'QBank',
  'tour.qbankDescription': 'Create custom practice tests and revisit previous ones to sharpen your skills and track your progress.',
  'tour.createTestTitle': 'Create Test',
  'tour.createTestDescription': 'Start here when you want to build a custom MBE-style practice set from selected subjects and chapters.',
  'tour.testModeTitle': 'Test Mode',
  'tour.testModeDescription': 'Tutor mode lets you submit each question and review the explanation immediately. Timed mode simulates an exam and shows explanations after completion.',
  'tour.questionModeTitle': 'Question Mode',
  'tour.questionModeDescription': 'Choose whether the test should use new questions, incorrect questions, marked questions, omitted questions, or questions you previously answered correctly.',
  'tour.subjectsTitle': 'Subjects and Chapters',
  'tour.subjectsDescription': 'Select the MBE subjects and chapters you want to practice. The question counts update from your imported database.',
  'tour.generateTitle': 'Generate Test',
  'tour.generateDescription': 'Confirm the number of questions and generate the test. PassBar will save your progress and answer history as you practice.',
  'auth.signOut': 'Sign out',
  'profile.open': 'Open profile',
  'profile.details': 'Profile details',
  'role.student': 'Student',
  'settings.title': 'Settings',
  'settings.description': 'Choose how questions and explanations appear during practice.',
  'settings.interfaceLanguage': 'Interface Language',
  'settings.interfaceLanguageDescription': 'Change app menus, buttons, and labels.',
  'settings.english': 'English',
  'settings.simplifiedChinese': 'Simplified Chinese (简体)',
  'settings.traditionalChinese': 'Traditional Chinese (繁體)',
  'settings.questionDisplay': 'Question Display',
  'settings.questionDisplayDescription': 'This affects the test interface and explanation panel.',
  'settings.englishQuestion': 'English question + English explanation',
  'settings.englishQuestionDescription': 'Show the original English stem, English options, and source explanation images.',
  'settings.bilingualQuestion': 'Chinese-English question + bilingual explanation',
  'settings.bilingualQuestionDescription': 'Show fetched Chinese-English stem/options and bilingual explanation when available.',
  'settings.textSize': 'Text Size',
  'settings.textSizeDescription': 'Adjust reading size for questions, answer choices, and explanations.',
  'settings.small': 'Small',
  'settings.medium': 'Standard',
  'settings.large': 'Large',
  'settings.compactReading': 'Compact reading',
  'settings.comfortableReading': 'Standard reading',
  'settings.largerReading': 'Larger reading',
  'settings.save': 'Save Settings',
  'settings.saved': 'Saved',
  'settings.saving': 'Saving...',
  'settings.savedDescription': 'Your settings were saved and will apply next time you sign in.',
  'settings.saveFailed': 'Settings were saved locally, but cloud sync failed.',
  'settings.autoSaveHint': 'Changes save automatically.',
  'create.title': 'Create Test',
  'create.testDate': 'Test Date',
  'create.today': 'Today',
  'create.launchTutorial': 'Launch Tutorial',
  'create.testMode': 'Test Mode',
  'create.testModeHint': 'Choose how answers and explanations are shown during a test.',
  'create.tutorModeHint': 'Submit each question and review the explanation immediately.',
  'create.timedModeHint': 'Simulate exam mode. Answer all questions before reviewing explanations.',
  'create.tutor': 'Tutor',
  'create.timed': 'Timed',
  'create.browse': 'Browse',
  'create.browseModeHint': 'Instantly view the correct answer and explanation for every question — no answering required.',
  'create.questionMode': 'Question Mode',
  'create.questionModeHint': 'Choose which question history buckets are eligible for this test.',
  'create.standard': 'Standard',
  'create.custom': 'Custom',
  'create.unused': 'Unused',
  'create.unusedHint': 'Selects questions from a set of new/unseen questions',
  'create.incorrect': 'Incorrect',
  'create.incorrectHint': 'Selects questions that were previously answered incorrectly',
  'create.marked': 'Marked',
  'create.markedHint': 'Selects questions that were previously marked/flagged for review',
  'create.omitted': 'Omitted',
  'create.omittedHint': 'Selects questions that were omitted previously',
  'create.correct': 'Correct',
  'create.correctHint': 'Selects questions that were previously answered correctly',
  'create.subjectsAndChapters': 'Subjects and Chapters',
  'create.collapseAll': 'Collapse All',
  'create.noOfQuestions': 'No. of Questions',
  'create.maxAllowed': 'Max allowed based on selection: {count}',
  'create.generateTest': 'Generate Test',
  'create.generating': 'Generating...',
  'create.selectChapterAlert': 'Please select at least one chapter with questions.',
  'create.noQuestionsAlert': 'No questions found for the selected chapters. Check your Supabase import or choose another chapter.',
  'create.selectedChapters': 'Selected chapters',
  'create.availableQuestions': 'Available questions',
  'create.readyToGenerate': 'Ready to generate',
  'create.totalQuestions': 'Total questions',
  'create.practicedQuestions': 'Practiced',
  'create.unpracticedQuestions': 'Unpracticed',
  'test.submit': 'Submit',
  'test.explanation': 'Explanation',
  'test.submitToViewExplanation': 'Submit your answer to view the explanation.',
  'test.end': 'End',
  'test.suspend': 'Suspend',
  'test.resume': 'Resume',
  'test.feedback': 'Feedback',
  'test.previous': 'Previous',
  'test.next': 'Next',
  'test.correct': 'Correct',
  'test.incorrect': 'Incorrect',
  'test.correctAnswer': 'Correct answer',
  'test.answeredCorrectly': 'Answered correctly',
  'test.timeSpent': 'Time Spent',
  'test.markQuestion': 'Mark question',
  'test.unmarkQuestion': 'Unmark question',
  'test.questions': 'Questions',
  'test.answeredCount': '{answered}/{total} answered',
  'test.current': 'Current',
  'test.answered': 'Answered',
  'test.marked': 'Marked',
  'test.unanswered': 'Unanswered',
  'test.aiFeedback': 'Gemini Feedback',
  'test.generatingFeedback': 'Analyzing your answers...',
  'test.feedbackError': 'Could not generate feedback. Check your Gemini API key and model settings.',
  'test.feedbackEmpty': 'Answer at least one question before requesting feedback.',
  'test.completeTimedBeforeReview': 'Timed mode is a simulated exam. Answer all questions before reviewing explanations. Answered {answered}/{total}.',
  'test.confirmEndTitle': 'End this practice session?',
  'test.confirmEndDescription': 'Your current progress has been saved. You have answered {answered}/{total} questions. Confirm to finish this session.',
  'test.cancelEnd': 'Keep practicing',
  'test.confirmEnd': 'End session',
  'test.ending': 'Ending...',
  'test.close': 'Close',
  'explanation.title': 'Explanation',
  'explanation.visualGuide': 'Visual Guide',
  'explanation.image': 'Explanation image {index}',
  'explanation.reviewSource': 'Review the source explanation below.',
  'explanation.highlight': 'Highlight',
  'explanation.geminiFeedback': 'AI Explanation',
  'explanation.geminiLoading': 'Analyzing this question...',
  'explanation.geminiError': 'Gemini feedback could not be loaded.',
  'explanation.eliminateChoice': 'Eliminate choice {choice}',
  'explanation.restoreChoice': 'Restore choice {choice}',
  'dashboard.welcome': 'Welcome back, {name}',
  'dashboard.loading': 'Loading your PassBar progress...',
  'dashboard.answered': "You've answered {solved} of {total} imported questions.",
  'dashboard.ready': '{total} questions are ready in your QBank.',
  'dashboard.viewHistory': 'View History',
  'dashboard.startNewSession': 'Start New Session',
  'dashboard.overallMastery': 'Overall Mastery',
  'dashboard.questionsSolved': 'Questions Practiced',
  'dashboard.totalQuestions': 'Total Questions',
  'dashboard.practiceAttempts': '{count} total attempts',
  'dashboard.today': 'today',
  'dashboard.studyStreak': 'Study Streak',
  'dashboard.days': 'Days',
  'dashboard.timeToday': 'Time Today',
  'dashboard.remaining': '{count} questions remaining',
  'dashboard.subjectPerformance': 'Subject Performance',
  'dashboard.subjectPerformanceDescription': 'Accuracy percentage from your saved answers',
  'dashboard.noPerformance': 'Start a practice session to build subject performance data.',
  'dashboard.recentInsights': 'Recent Insights',
  'dashboard.strongInsightTitle': 'Strong: {subject}',
  'dashboard.strongInsightDescription': '{score}% accuracy across {total} answered questions.',
  'dashboard.reviewInsightTitle': 'Review: {subject}',
  'dashboard.reviewInsightDescription': '{score}% accuracy. Consider a targeted test for this subject.',
  'dashboard.noAnswers': 'No answers yet',
  'dashboard.noAnswersDescription': 'Your insights will appear after you complete practice questions.',
  'dashboard.aiFeedbackEnabled': 'Gemini feedback enabled',
  'dashboard.aiFeedbackEnabledDescription': 'AI study feedback is available during practice sessions.',
  'dashboard.aiFeedbackDisabled': 'Gemini feedback not configured',
  'dashboard.aiFeedbackDisabledDescription': 'Add a Gemini API key on the server to enable AI study feedback.',
  'dashboard.aiFeedbackUnknown': 'Gemini backend could not be reached',
  'dashboard.aiFeedbackUnknownDescription': 'The API key is configured locally, but this page cannot reach a backend Gemini endpoint. GitHub Pages cannot run Next.js API routes.',
  'dashboard.nextMilestone': 'Next Milestone',
  'dashboard.milestoneText': 'Complete {count} more questions to reach your next practice milestone.',
  'dashboard.startLearning': 'Start Learning',
  'review.title': 'Previous Test',
  'review.description': 'Review your past performance and study incorrect answers.',
  'review.searchPlaceholder': 'Search topics...',
  'review.noSessions': 'No sessions yet',
  'review.noSessionsDescription': 'Start your first practice test to begin tracking your progress and mastering the material.',
  'review.createFirstTest': 'Create Your First Test',
  'review.accuracy': 'Accuracy',
  'review.duration': 'Duration',
  'review.correct': 'Correct',
  'review.reviewQuestions': 'Review Questions',
  'review.mixedSubjects': 'Mixed Subjects',
  'review.loading': 'Loading test history...',
  'performance.title': 'Performance Analytics',
  'performance.description': 'Detailed breakdown of your strengths and opportunities.',
  'performance.loading': 'Loading your saved answer history...',
  'performance.noAnswersTitle': 'No saved answers yet',
  'performance.noAnswersDescription': 'Complete a practice session and PassBar will break down your real subject and chapter performance here.',
  'performance.startPractice': 'Start Practice',
  'performance.overallAccuracy': 'Overall Accuracy',
  'performance.correctTotal': 'Correct / Total',
  'performance.avgTime': 'Avg. Time',
  'performance.subjectsPracticed': 'Subjects Practiced',
  'performance.subjectAccuracy': 'Subject Accuracy',
  'performance.subjectAccuracyDescription': 'Correct rate and answer volume by real MBE subject',
  'performance.highestYieldReview': 'Highest Yield Review',
  'performance.highestYieldDescription': 'Lowest chapter accuracy, sorted by weakness',
  'performance.questionsOverTime': 'Questions Answered Over Time',
  'performance.questionsOverTimeDescription': 'Weekly practice volume by subject, using your actual answer timestamps',
  'performance.strongChapters': 'Strong Chapters',
  'performance.strongChaptersDescription': 'Chapters where your saved answers are currently strongest',
  'performance.correctCount': '{correct}/{total} correct',
  'performance.unknownSubject': 'Unknown Subject',
  'performance.unknownChapter': 'Unknown Chapter',
};

const zhHans: Dictionary = {
  ...en,
  'app.tagline': '法考备考工作区',
  'nav.dashboard': '首页',
  'nav.openNavigation': '打开导航',
  'nav.qbank': '题库',
  'nav.createTest': '创建测验',
  'nav.previousTests': '历史练习',
  'nav.performance': '学习表现',
  'nav.assessments': '测评',
  'nav.tools': '工具',
  'nav.settings': '设置',
  'nav.tutorial': '教程',
  'nav.resetOptions': '重置选项',
  'nav.help': '帮助',
  'tour.stepOf': '{current} / {total}',
  'tour.back': '上一步',
  'tour.next': '下一步',
  'tour.done': '完成',
  'tour.qbankTitle': '题库',
  'tour.qbankDescription': '建立自定义测验，复习过去练习，并持续追踪你的备考进度。',
  'tour.createTestTitle': '创建测验',
  'tour.createTestDescription': '从这里开始选择科目与章节，生成适合自己的 MBE 风格练习。',
  'tour.testModeTitle': '练习模式',
  'tour.testModeDescription': '教学模式可以每题提交后立即看解析；计时模式模拟考试，完成后才查看所有解析。',
  'tour.questionModeTitle': '题目模式',
  'tour.questionModeDescription': '选择本次测验要抽取未做、错误、标记、略过或之前答对的题目。',
  'tour.subjectsTitle': '科目与章节',
  'tour.subjectsDescription': '选择想练习的 MBE 科目与章节。题目数量会从已导入的数据库自动统计。',
  'tour.generateTitle': '生成测验',
  'tour.generateDescription': '确认题目数量后生成测验。练习过程中 PassBar 会保存你的进度与作答纪录。',
  'auth.signOut': '退出登录',
  'profile.open': '打开个人资料',
  'profile.details': '个人资料',
  'role.student': '学生',
  'settings.title': '设置',
  'settings.description': '选择练习时题目与解析的显示方式。',
  'settings.interfaceLanguage': '界面语言',
  'settings.interfaceLanguageDescription': '切换菜单、按钮与界面标签语言。',
  'settings.english': '英文',
  'settings.simplifiedChinese': '简体中文（简体）',
  'settings.traditionalChinese': '繁體中文（繁體）',
  'settings.questionDisplay': '题目显示',
  'settings.questionDisplayDescription': '影响做题界面与解析面板。',
  'settings.englishQuestion': '英文题目 + 英文解析',
  'settings.englishQuestionDescription': '显示原始英文题干、英文选项与原始解析图片。',
  'settings.bilingualQuestion': '中英题目 + 中英解析',
  'settings.bilingualQuestionDescription': '有 fetch 结果时显示中英题干、选项与中英解析。',
  'settings.textSize': '文字大小',
  'settings.textSizeDescription': '调整题干、选项与解析的阅读字号。',
  'settings.small': '小',
  'settings.medium': '标准',
  'settings.large': '大',
  'settings.compactReading': '紧凑阅读',
  'settings.comfortableReading': '标准阅读',
  'settings.largerReading': '大字阅读',
  'settings.save': '保存设置',
  'settings.saved': '已保存',
  'settings.saving': '保存中...',
  'settings.savedDescription': '设置已保存，下次登录会自动套用。',
  'settings.saveFailed': '设置已保存到本机，但云端同步失败。',
  'settings.autoSaveHint': '更改会自动保存。',
  'create.title': '创建测验',
  'create.testDate': '练习日期',
  'create.today': '今天',
  'create.launchTutorial': '打开教程',
  'create.testMode': '练习模式',
  'create.testModeHint': '选择测验过程中答案与解析的显示方式。',
  'create.tutorModeHint': '每做一题即可提交，并立即查看解析。',
  'create.timedModeHint': '模拟考试模式。完成所有题目后才能查看解析。',
  'create.tutor': '教学',
  'create.timed': '计时',
  'create.browse': '速览',
  'create.browseModeHint': '直接查看每道题的正确答案与解析，无需作答。',
  'create.questionMode': '题目模式',
  'create.questionModeHint': '选择本次测验可抽取的题目记录类型。',
  'create.standard': '标准',
  'create.custom': '自定义',
  'create.unused': '未做',
  'create.unusedHint': '从未做过的新题中抽题',
  'create.incorrect': '错误',
  'create.incorrectHint': '从之前答错的题目中抽题',
  'create.marked': '标记',
  'create.markedHint': '从之前标记/收藏待复习的题目中抽题',
  'create.omitted': '略过',
  'create.omittedHint': '从之前略过的题目中抽题',
  'create.correct': '正确',
  'create.correctHint': '从之前答对的题目中抽题',
  'create.subjectsAndChapters': '科目与章节',
  'create.collapseAll': '全部收起',
  'create.noOfQuestions': '题目数量',
  'create.maxAllowed': '当前选择最多可用：{count}',
  'create.generateTest': '生成练习',
  'create.generating': '生成中...',
  'create.selectChapterAlert': '请选择至少一个有题目的章节。',
  'create.noQuestionsAlert': '所选章节没有找到题目。请检查 Supabase 导入或选择其他章节。',
  'create.selectedChapters': '已选章节',
  'create.availableQuestions': '可用题目',
  'create.readyToGenerate': '准备生成',
  'create.totalQuestions': '总题数',
  'create.practicedQuestions': '已练习',
  'create.unpracticedQuestions': '未练习',
  'test.submit': '提交',
  'test.explanation': '解析',
  'test.submitToViewExplanation': '提交答案后查看解析。',
  'test.end': '结束',
  'test.suspend': '暂停',
  'test.resume': '继续',
  'test.feedback': '反馈',
  'test.previous': '上一题',
  'test.next': '下一题',
  'test.correct': '正确',
  'test.incorrect': '错误',
  'test.correctAnswer': '正确答案',
  'test.answeredCorrectly': '答对比例',
  'test.timeSpent': '作答时间',
  'test.markQuestion': '标记题目',
  'test.unmarkQuestion': '取消标记',
  'test.questions': '题目',
  'test.answeredCount': '已作答 {answered}/{total}',
  'test.current': '当前',
  'test.answered': '已作答',
  'test.marked': '已标记',
  'test.unanswered': '未作答',
  'test.aiFeedback': 'Gemini 反馈',
  'test.generatingFeedback': '正在分析你的作答...',
  'test.feedbackError': '无法生成反馈。请检查 Gemini API key 和模型设置。',
  'test.feedbackEmpty': '请至少作答一题后再请求反馈。',
  'test.completeTimedBeforeReview': '计时模式是模拟考试。请先完成所有题目，再查看解析。已作答 {answered}/{total}。',
  'test.confirmEndTitle': '结束这次练习？',
  'test.confirmEndDescription': '当前进度已保存。你已作答 {answered}/{total} 题。确认后将结束本次练习。',
  'test.cancelEnd': '继续练习',
  'test.confirmEnd': '结束练习',
  'test.ending': '正在结束...',
  'test.close': '关闭',
  'explanation.title': '解析',
  'explanation.visualGuide': '图片解析',
  'explanation.image': '解析图片 {index}',
  'explanation.reviewSource': '查看下方原始解析。',
  'explanation.highlight': '荧光笔',
  'explanation.geminiFeedback': 'AI 解析',
  'explanation.geminiLoading': '正在分析这道题...',
  'explanation.geminiError': '无法加载 Gemini 反馈。',
  'explanation.eliminateChoice': '刪去选项 {choice}',
  'explanation.restoreChoice': '恢复选项 {choice}',
  'dashboard.welcome': '欢迎回来，{name}',
  'dashboard.loading': '正在加载你的学习进度...',
  'dashboard.answered': '你已完成 {solved} / {total} 道导入题目。',
  'dashboard.ready': '题库中已有 {total} 道题目可用。',
  'dashboard.viewHistory': '查看历史',
  'dashboard.startNewSession': '开始新练习',
  'dashboard.overallMastery': '总体掌握度',
  'dashboard.questionsSolved': '已练题数',
  'dashboard.totalQuestions': '总题数',
  'dashboard.practiceAttempts': '累计作答 {count} 次',
  'dashboard.today': '今日',
  'dashboard.studyStreak': '连续学习',
  'dashboard.days': '天',
  'dashboard.timeToday': '今日时长',
  'dashboard.remaining': '剩余 {count} 题',
  'dashboard.subjectPerformance': '科目表现',
  'dashboard.subjectPerformanceDescription': '根据已保存答案计算正确率',
  'dashboard.noPerformance': '开始练习后会生成科目表现数据。',
  'dashboard.recentInsights': '近期洞察',
  'dashboard.strongInsightTitle': '强项：{subject}',
  'dashboard.strongInsightDescription': '已作答 {total} 题，正确率 {score}%。',
  'dashboard.reviewInsightTitle': '复习：{subject}',
  'dashboard.reviewInsightDescription': '正确率 {score}%。建议针对这个科目创建专项练习。',
  'dashboard.noAnswers': '尚无作答',
  'dashboard.noAnswersDescription': '完成练习题后，这里会显示你的学习洞察。',
  'dashboard.aiFeedbackEnabled': 'Gemini 反馈已启用',
  'dashboard.aiFeedbackEnabledDescription': '做题时可以取得 AI 学习反馈。',
  'dashboard.aiFeedbackDisabled': 'Gemini 反馈尚未设置',
  'dashboard.aiFeedbackDisabledDescription': '请在服务器环境变量加入 Gemini API key，以启用 AI 学习反馈。',
  'dashboard.aiFeedbackUnknown': '无法连接 Gemini 后端',
  'dashboard.aiFeedbackUnknownDescription': '本机 API key 已设置，但当前页面无法连接 Gemini 后端。GitHub Pages 不能运行 Next.js API routes。',
  'dashboard.nextMilestone': '下一个里程碑',
  'dashboard.milestoneText': '再完成 {count} 题即可达到下一个练习里程碑。',
  'dashboard.startLearning': '开始学习',
  'review.title': '历史测验',
  'review.description': '回顾过去表现，并复习答错的题目。',
  'review.searchPlaceholder': '搜索科目或章节...',
  'review.noSessions': '还没有练习记录',
  'review.noSessionsDescription': '开始第一次练习后，这里会自动追踪你的进度。',
  'review.createFirstTest': '创建第一次练习',
  'review.accuracy': '正确率',
  'review.duration': '用时',
  'review.correct': '正确',
  'review.reviewQuestions': '复习题目',
  'review.mixedSubjects': '综合科目',
  'review.loading': '正在加载练习历史...',
  'performance.title': '学习表现分析',
  'performance.description': '细分你的强项与需要加强的地方。',
  'performance.loading': '正在加载已保存的作答记录...',
  'performance.noAnswersTitle': '还没有保存的作答记录',
  'performance.noAnswersDescription': '完成一次练习后，PassBar 会在这里按真实科目与章节分析你的表现。',
  'performance.startPractice': '开始练习',
  'performance.overallAccuracy': '总体正确率',
  'performance.correctTotal': '正确 / 总数',
  'performance.avgTime': '平均用时',
  'performance.subjectsPracticed': '已练科目',
  'performance.subjectAccuracy': '科目正确率',
  'performance.subjectAccuracyDescription': '按真实 MBE 科目统计正确率与作答量',
  'performance.highestYieldReview': '优先复习章节',
  'performance.highestYieldDescription': '按章节正确率由低到高排序',
  'performance.questionsOverTime': '每周作答趋势',
  'performance.questionsOverTimeDescription': '根据实际作答时间按周统计各科练习量',
  'performance.strongChapters': '强项章节',
  'performance.strongChaptersDescription': '目前保存记录中表现最好的章节',
  'performance.correctCount': '{correct}/{total} 正确',
  'performance.unknownSubject': '未知科目',
  'performance.unknownChapter': '未知章节',
};

const zhHant: Dictionary = {
  'app.tagline': '法考備考工作區',
  'nav.dashboard': '首頁',
  'nav.openNavigation': '開啟導覽',
  'nav.qbank': '題庫',
  'nav.createTest': '建立測驗',
  'nav.previousTests': '歷史練習',
  'nav.performance': '學習表現',
  'nav.assessments': '測評',
  'nav.tools': '工具',
  'nav.settings': '設定',
  'nav.tutorial': '教學',
  'nav.resetOptions': '重設選項',
  'nav.help': '幫助',
  'tour.stepOf': '{current} / {total}',
  'tour.back': '上一步',
  'tour.next': '下一步',
  'tour.done': '完成',
  'tour.qbankTitle': '題庫',
  'tour.qbankDescription': '建立自訂測驗，複習過去練習，並持續追蹤你的備考進度。',
  'tour.createTestTitle': '建立測驗',
  'tour.createTestDescription': '從這裡開始選擇科目與章節，產生適合自己的 MBE 風格練習。',
  'tour.testModeTitle': '練習模式',
  'tour.testModeDescription': '教學模式可以每題提交後立即看解析；計時模式模擬考試，完成後才查看所有解析。',
  'tour.questionModeTitle': '題目模式',
  'tour.questionModeDescription': '選擇本次測驗要抽取未做、錯誤、標記、略過或之前答對的題目。',
  'tour.subjectsTitle': '科目與章節',
  'tour.subjectsDescription': '選擇想練習的 MBE 科目與章節。題目數量會從已匯入的資料庫自動統計。',
  'tour.generateTitle': '產生測驗',
  'tour.generateDescription': '確認題目數量後產生測驗。練習過程中 PassBar 會儲存你的進度與作答紀錄。',
  'auth.signOut': '登出',
  'profile.open': '開啟個人資料',
  'profile.details': '個人資料',
  'role.student': '學生',
  'settings.title': '設定',
  'settings.description': '選擇練習時題目與解析的顯示方式。',
  'settings.interfaceLanguage': '介面語言',
  'settings.interfaceLanguageDescription': '切換選單、按鈕與介面標籤語言。',
  'settings.english': '英文',
  'settings.simplifiedChinese': '简体中文（简体）',
  'settings.traditionalChinese': '繁體中文（繁體）',
  'settings.questionDisplay': '題目顯示',
  'settings.questionDisplayDescription': '影響做題介面與解析面板。',
  'settings.englishQuestion': '英文題目 + 英文解析',
  'settings.englishQuestionDescription': '顯示原始英文題幹、英文選項與原始解析圖片。',
  'settings.bilingualQuestion': '中英題目 + 中英解析',
  'settings.bilingualQuestionDescription': '有 fetch 結果時顯示中英題幹、選項與中英解析。',
  'settings.textSize': '文字大小',
  'settings.textSizeDescription': '調整題幹、選項與解析的閱讀字號。',
  'settings.small': '小',
  'settings.medium': '標準',
  'settings.large': '大',
  'settings.compactReading': '緊湊閱讀',
  'settings.comfortableReading': '標準閱讀',
  'settings.largerReading': '大字閱讀',
  'settings.save': '儲存設定',
  'settings.saved': '已儲存',
  'settings.saving': '儲存中...',
  'settings.savedDescription': '設定已儲存，下次登入會自動套用。',
  'settings.saveFailed': '設定已儲存到本機，但雲端同步失敗。',
  'settings.autoSaveHint': '更改會自動儲存。',
  'create.title': '建立測驗',
  'create.testDate': '練習日期',
  'create.today': '今天',
  'create.launchTutorial': '開啟教學',
  'create.testMode': '練習模式',
  'create.testModeHint': '選擇測驗過程中答案與解析的顯示方式。',
  'create.tutorModeHint': '每做一題即可提交，並立即查看解析。',
  'create.timedModeHint': '模擬考試模式。完成所有題目後才能查看解析。',
  'create.tutor': '教學',
  'create.timed': '計時',
  'create.browse': '速覽',
  'create.browseModeHint': '直接查看每道題的正確答案與解析，無需作答。',
  'create.questionMode': '題目模式',
  'create.questionModeHint': '選擇本次測驗可抽取的題目紀錄類型。',
  'create.standard': '標準',
  'create.custom': '自訂',
  'create.unused': '未做',
  'create.unusedHint': '從未做過的新題中抽題',
  'create.incorrect': '錯誤',
  'create.incorrectHint': '從之前答錯的題目中抽題',
  'create.marked': '標記',
  'create.markedHint': '從之前標記/收藏待複習的題目中抽題',
  'create.omitted': '略過',
  'create.omittedHint': '從之前略過的題目中抽題',
  'create.correct': '正確',
  'create.correctHint': '從之前答對的題目中抽題',
  'create.subjectsAndChapters': '科目與章節',
  'create.collapseAll': '全部收起',
  'create.noOfQuestions': '題目數量',
  'create.maxAllowed': '目前選擇最多可用：{count}',
  'create.generateTest': '產生練習',
  'create.generating': '產生中...',
  'create.selectChapterAlert': '請選擇至少一個有題目的章節。',
  'create.noQuestionsAlert': '所選章節沒有找到題目。請檢查 Supabase 匯入或選擇其他章節。',
  'create.selectedChapters': '已選章節',
  'create.availableQuestions': '可用題目',
  'create.readyToGenerate': '準備產生',
  'create.totalQuestions': '總題數',
  'create.practicedQuestions': '已練習',
  'create.unpracticedQuestions': '未練習',
  'test.submit': '提交',
  'test.explanation': '解析',
  'test.submitToViewExplanation': '提交答案後查看解析。',
  'test.end': '結束',
  'test.suspend': '暫停',
  'test.resume': '繼續',
  'test.feedback': '回饋',
  'test.previous': '上一題',
  'test.next': '下一題',
  'test.correct': '正確',
  'test.incorrect': '錯誤',
  'test.correctAnswer': '正確答案',
  'test.answeredCorrectly': '答對比例',
  'test.timeSpent': '作答時間',
  'test.markQuestion': '標記題目',
  'test.unmarkQuestion': '取消標記',
  'test.questions': '題目',
  'test.answeredCount': '已作答 {answered}/{total}',
  'test.current': '目前',
  'test.answered': '已作答',
  'test.marked': '已標記',
  'test.unanswered': '未作答',
  'test.aiFeedback': 'Gemini 回饋',
  'test.generatingFeedback': '正在分析你的作答...',
  'test.feedbackError': '無法產生回饋。請檢查 Gemini API key 和模型設定。',
  'test.feedbackEmpty': '請至少作答一題後再請求回饋。',
  'test.completeTimedBeforeReview': '計時模式是模擬考試。請先完成所有題目，再查看解析。已作答 {answered}/{total}。',
  'test.confirmEndTitle': '結束這次練習？',
  'test.confirmEndDescription': '目前進度已儲存。你已作答 {answered}/{total} 題。確認後將結束本次練習。',
  'test.cancelEnd': '繼續練習',
  'test.confirmEnd': '結束練習',
  'test.ending': '正在結束...',
  'test.close': '關閉',
  'explanation.title': '解析',
  'explanation.visualGuide': '圖片解析',
  'explanation.image': '解析圖片 {index}',
  'explanation.reviewSource': '查看下方原始解析。',
  'explanation.highlight': '螢光筆',
  'explanation.geminiFeedback': 'AI 解析',
  'explanation.geminiLoading': '正在分析這道題...',
  'explanation.geminiError': '無法載入 Gemini 回饋。',
  'explanation.eliminateChoice': '刪去選項 {choice}',
  'explanation.restoreChoice': '恢復選項 {choice}',
  'dashboard.welcome': '歡迎回來，{name}',
  'dashboard.loading': '正在載入你的學習進度...',
  'dashboard.answered': '你已完成 {solved} / {total} 道匯入題目。',
  'dashboard.ready': '題庫中已有 {total} 道題目可用。',
  'dashboard.viewHistory': '查看歷史',
  'dashboard.startNewSession': '開始新練習',
  'dashboard.overallMastery': '整體掌握度',
  'dashboard.questionsSolved': '已練題數',
  'dashboard.totalQuestions': '總題數',
  'dashboard.practiceAttempts': '累計作答 {count} 次',
  'dashboard.today': '今日',
  'dashboard.studyStreak': '連續學習',
  'dashboard.days': '天',
  'dashboard.timeToday': '今日時長',
  'dashboard.remaining': '剩餘 {count} 題',
  'dashboard.subjectPerformance': '科目表現',
  'dashboard.subjectPerformanceDescription': '根據已儲存答案計算正確率',
  'dashboard.noPerformance': '開始練習後會產生科目表現資料。',
  'dashboard.recentInsights': '近期洞察',
  'dashboard.strongInsightTitle': '強項：{subject}',
  'dashboard.strongInsightDescription': '已作答 {total} 題，正確率 {score}%。',
  'dashboard.reviewInsightTitle': '複習：{subject}',
  'dashboard.reviewInsightDescription': '正確率 {score}%。建議針對這個科目建立專項練習。',
  'dashboard.noAnswers': '尚無作答',
  'dashboard.noAnswersDescription': '完成練習題後，這裡會顯示你的學習洞察。',
  'dashboard.aiFeedbackEnabled': 'Gemini 回饋已啟用',
  'dashboard.aiFeedbackEnabledDescription': '做題時可以取得 AI 學習回饋。',
  'dashboard.aiFeedbackDisabled': 'Gemini 回饋尚未設定',
  'dashboard.aiFeedbackDisabledDescription': '請在伺服器環境變數加入 Gemini API key，以啟用 AI 學習回饋。',
  'dashboard.aiFeedbackUnknown': '無法連接 Gemini 後端',
  'dashboard.aiFeedbackUnknownDescription': '本機 API key 已設定，但目前頁面無法連接 Gemini 後端。GitHub Pages 不能執行 Next.js API routes。',
  'dashboard.nextMilestone': '下一個里程碑',
  'dashboard.milestoneText': '再完成 {count} 題即可達到下一個練習里程碑。',
  'dashboard.startLearning': '開始學習',
  'review.title': '歷史測驗',
  'review.description': '回顧過去表現，並複習答錯的題目。',
  'review.searchPlaceholder': '搜尋科目或章節...',
  'review.noSessions': '還沒有練習紀錄',
  'review.noSessionsDescription': '開始第一次練習後，這裡會自動追蹤你的進度。',
  'review.createFirstTest': '建立第一次練習',
  'review.accuracy': '正確率',
  'review.duration': '用時',
  'review.correct': '正確',
  'review.reviewQuestions': '複習題目',
  'review.mixedSubjects': '綜合科目',
  'review.loading': '正在載入練習歷史...',
  'performance.title': '學習表現分析',
  'performance.description': '細分你的強項與需要加強的地方。',
  'performance.loading': '正在載入已儲存的作答紀錄...',
  'performance.noAnswersTitle': '還沒有儲存的作答紀錄',
  'performance.noAnswersDescription': '完成一次練習後，PassBar 會在這裡按真實科目與章節分析你的表現。',
  'performance.startPractice': '開始練習',
  'performance.overallAccuracy': '整體正確率',
  'performance.correctTotal': '正確 / 總數',
  'performance.avgTime': '平均用時',
  'performance.subjectsPracticed': '已練科目',
  'performance.subjectAccuracy': '科目正確率',
  'performance.subjectAccuracyDescription': '按真實 MBE 科目統計正確率與作答量',
  'performance.highestYieldReview': '優先複習章節',
  'performance.highestYieldDescription': '按章節正確率由低到高排序',
  'performance.questionsOverTime': '每週作答趨勢',
  'performance.questionsOverTimeDescription': '根據實際作答時間按週統計各科練習量',
  'performance.strongChapters': '強項章節',
  'performance.strongChaptersDescription': '目前儲存紀錄中表現最好的章節',
  'performance.correctCount': '{correct}/{total} 正確',
  'performance.unknownSubject': '未知科目',
  'performance.unknownChapter': '未知章節',
};

const dictionaries: Record<InterfaceLanguage, Dictionary> = {
  en,
  'zh-Hans': zhHans,
  'zh-Hant': zhHant,
};

function interpolate(template: string, params?: Record<string, string | number>) {
  if (!params) return template;
  return Object.entries(params).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

export function translate(language: InterfaceLanguage, key: TranslationKey, params?: Record<string, string | number>) {
  return interpolate(dictionaries[language][key] ?? en[key], params);
}

export function useI18n() {
  const [language, setLanguage] = useState<InterfaceLanguage>('en');

  useEffect(() => {
    setLanguage(getStudySettings().interfaceLanguage);
    const handleSettingsChange = (event: Event) => {
      const next = (event as CustomEvent<{ interfaceLanguage?: InterfaceLanguage }>).detail;
      if (next?.interfaceLanguage) setLanguage(next.interfaceLanguage);
    };
    window.addEventListener('passbar-study-settings-changed', handleSettingsChange);
    return () => window.removeEventListener('passbar-study-settings-changed', handleSettingsChange);
  }, []);

  return useMemo(() => ({
    language,
    t: (key: TranslationKey, params?: Record<string, string | number>) => translate(language, key, params),
  }), [language]);
}
