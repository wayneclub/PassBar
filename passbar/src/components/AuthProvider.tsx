"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { getStudySettings, saveStudySettings, type StudySettings } from '@/lib/study-settings';

export type UserProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: string | null;
  last_seen_at: string | null;
  study_settings: StudySettings | null;
};

type AuthContextValue = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type AuthEventType = 'session_checked' | 'signed_in' | 'signed_out' | 'token_refreshed';

function providerForSession(session: Session) {
  const identities = session.user.identities ?? [];
  return identities[0]?.provider ?? session.user.app_metadata?.provider ?? null;
}

async function recordAuthEvent(eventType: AuthEventType, session: Session | null) {
  if (!supabase || !session?.user) return;

  const expiresAt = session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null;
  const path = typeof window === 'undefined'
    ? null
    : `${window.location.pathname}${window.location.search}`;
  const userAgent = typeof navigator === 'undefined' ? null : navigator.userAgent;

  const { error } = await supabase.rpc('record_auth_event', {
    p_event_type: eventType,
    p_provider: providerForSession(session),
    p_email: session.user.email ?? null,
    p_session_expires_at: expiresAt,
    p_user_agent: userAgent,
    p_path: path,
    p_metadata: {
      aud: session.user.aud,
      role: session.user.role,
    },
  });

  if (error && error.message !== '204') {
    console.warn('[PassBar] Failed to record auth event:', error.message);
  }
}

function eventTypeForAuthChange(event: AuthChangeEvent): AuthEventType | null {
  if (event === 'SIGNED_IN') return 'signed_in';
  if (event === 'SIGNED_OUT') return 'signed_out';
  if (event === 'TOKEN_REFRESHED') return 'token_refreshed';
  return null;
}

function clearLocalSupabaseSession() {
  if (typeof window === 'undefined') return;

  const storageKeys = [
    ...Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index)),
    ...Array.from({ length: window.sessionStorage.length }, (_, index) => window.sessionStorage.key(index)),
  ].filter((key): key is string => Boolean(key));

  storageKeys
    .filter((key) => key.startsWith('sb-') && key.endsWith('-auth-token'))
    .forEach((key) => {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
    });
}

function profileFallback(user: User): UserProfile {
  return {
    id: user.id,
    email: user.email ?? null,
    full_name: typeof user.user_metadata?.full_name === 'string'
      ? user.user_metadata.full_name
      : typeof user.user_metadata?.name === 'string'
        ? user.user_metadata.name
        : null,
    avatar_url: typeof user.user_metadata?.avatar_url === 'string' ? user.user_metadata.avatar_url : null,
    role: 'student',
    last_seen_at: null,
    study_settings: null,
  };
}

async function getProfile(user: User): Promise<UserProfile> {
  if (!supabase) return profileFallback(user);

  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url, role, last_seen_at, study_settings')
    .eq('id', user.id)
    .maybeSingle();

  if (error || !data) {
    if (error) console.warn('[PassBar] Failed to load profile:', error.message);
    return profileFallback(user);
  }

  return data as UserProfile;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    saveStudySettings(getStudySettings());

    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
      if (data.session) {
        recordAuthEvent('session_checked', data.session);
        getProfile(data.session.user).then((nextProfile) => {
          if (!active) return;
          setProfile(nextProfile);
          if (nextProfile.study_settings) saveStudySettings(nextProfile.study_settings);
        });
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
      if (!nextSession?.user) {
        setProfile(null);
      } else {
        getProfile(nextSession.user).then((nextProfile) => {
          if (!active) return;
          setProfile(nextProfile);
          if (nextProfile.study_settings) saveStudySettings(nextProfile.study_settings);
        });
      }
      const authEventType = eventTypeForAuthChange(event);
      if (authEventType && nextSession) {
        recordAuthEvent(authEventType, nextSession);
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    loading,
    session,
    user: session?.user ?? null,
    profile,
    signOut: async () => {
      if (!supabase) return;
      await recordAuthEvent('signed_out', session);
      clearLocalSupabaseSession();
      setSession(null);
      setProfile(null);
    },
  }), [loading, session, profile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return value;
}
