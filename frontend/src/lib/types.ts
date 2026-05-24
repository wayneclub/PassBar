export type QuestionStatus = 'Unused' | 'Incorrect' | 'Marked' | 'Omitted' | 'Correct';

export interface Chapter {
  id: string;
  name: string;
  count: number;
}

export interface Subject {
  id: string;
  name: string;
  count: number;
  chapters: Chapter[];
}

export interface Question {
  id: string;
  subject: string;
  topic: string;
  questionText: string;
  options: string[];
  correctAnswer: string;
  apiMatchOk: boolean;
  explainImgs: string[];
  sourceExplanationImageFile?: string;
  explanationHtml?: string;
}

export type TestMode = 'Tutor' | 'Timed';
export type QuestionSelectionMode = 'Standard' | 'Custom';

export interface TestSession {
  id: string;
  createdAt: number;
  mode: TestMode;
  subjects: string[];
  chapters: string[];
  questionCount: number;
  questionIds: string[];
  userAnswers: Record<string, string>; // questionId -> answer
  status: 'In-Progress' | 'Completed' | 'Suspended';
  timeSpent: number; // in seconds
}

export interface PerformanceStats {
  totalQuestions: number;
  completedTests: number;
  averageScore: number;
  subjectPerformance: Record<string, { correct: number; total: number }>;
}
