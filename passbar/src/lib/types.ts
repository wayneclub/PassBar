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
  index: number;
  subject: string;
  topic: string;
  questionText: string;
  bilingualQuestionText?: string;
  zhQuestionText?: string;          // pure Chinese question (from enriched json)
  options: string[];
  bilingualOptions?: string[];
  zhOptions?: string[];             // pure Chinese choices (from enriched json)
  correctAnswer: string;
  correctAnswerLetter?: string;
  apiAnswerKey?: string;
  apiMatchOk: boolean;
  explainImgs: string[];
  zhExplainImgs?: string[];
  sourceExplanationImageFile?: string;
  sourceExplanationImageUrl?: string;
  enExplanationHtml?: string;       // gemini-generated English interactive HTML
  explanationHtml?: string;         // zh explanation html
  explanationOcr?: ExplanationOcr[];
}

export interface ExplanationOcrWord {
  text: string;
  confidence?: number | null;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface ExplanationOcr {
  publicUrl: string;
  text: string | null;
  words: ExplanationOcrWord[];
}

export type TestMode = 'Tutor' | 'Timed' | 'Browse' | 'SimExam';
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
  userAnswerChoices?: Record<string, string>; // questionId -> selected choice key
  status: 'In-Progress' | 'Completed' | 'Suspended';
  timeSpent: number; // in seconds
  timeLimitSeconds?: number; // countdown limit (SimExam: 10800)
}

export interface PerformanceStats {
  totalQuestions: number;
  completedTests: number;
  averageScore: number;
  subjectPerformance: Record<string, { correct: number; total: number }>;
}
