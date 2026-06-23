"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiError, authServiceUrl } from '@/lib/api';
import { getStudySettings, saveStudySettings, type StudySettings } from '@/lib/study-settings';

export type UserProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: string | null;
  status: 'pending' | 'approved' | 'rejected' | null;
  last_seen_at: string | null;
  study_settings: StudySettings | null;
  exam_date: string | null;
  created_at: string | null;
};

export type AuthUser = {
  id: string;
  email: string | null;
};

type AuthContextValue = {
  loading: boolean;
  user: AuthUser | null;
  profile: UserProfile | null;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type ProfileResponse = {
  id: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  role: string | null;
  status: 'pending' | 'approved' | 'rejected' | null;
  lastSeenAt: string | null;
  studySettings: Record<string, unknown> | null;
  examDate: string | null;
  createdAt: string | null;
};

function toProfile(data: ProfileResponse): UserProfile {
  return {
    id: data.id,
    email: data.email,
    full_name: data.fullName,
    avatar_url: data.avatarUrl,
    role: data.role,
    status: data.status,
    last_seen_at: data.lastSeenAt,
    study_settings: (data.studySettings as StudySettings | null) ?? null,
    exam_date: data.examDate,
    created_at: data.createdAt,
  };
}

async function fetchProfile(): Promise<UserProfile | null> {
  try {
    const data = await api.get<ProfileResponse>('/users/me');
    return toProfile(data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    console.warn('[PassBar] Failed to load profile:', err);
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    saveStudySettings(getStudySettings());

    let active = true;
    fetchProfile().then((nextProfile) => {
      if (!active) return;
      setProfile(nextProfile);
      setLoading(false);
      if (nextProfile?.study_settings) saveStudySettings(nextProfile.study_settings);
    });

    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    loading,
    user: profile ? { id: profile.id, email: profile.email } : null,
    profile,
    signOut: async () => {
      // Sign-out is handled by auth-service, not the PassBar backend — that's where the
      // access_token/refresh_token cookies were issued and where the session gets revoked.
      await fetch(authServiceUrl('/auth/signout'), { method: 'POST', credentials: 'include' }).catch(() => undefined);
      setProfile(null);
      window.location.href = '/auth';
    },
    refreshProfile: async () => {
      const nextProfile = await fetchProfile();
      setProfile(nextProfile);
    },
  }), [loading, profile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return value;
}
