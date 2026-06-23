export type UserProfile = {
  id: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  role: 'student' | 'admin';
  status: 'pending' | 'approved' | 'rejected';
  studySettings: Record<string, unknown>;
  examDate: string | null;
};
