"use client";

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TestSession } from '@/lib/types';
import { 
  Calendar, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  ArrowRight,
  Search,
  Filter
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import Link from 'next/link';

export default function ReviewHistoryPage() {
  const [sessions, setSessions] = useState<TestSession[]>([]);

  useEffect(() => {
    const data = JSON.parse(localStorage.getItem('passbar_sessions') || localStorage.getItem('uprep_sessions') || '[]');
    setSessions(data.sort((a: any, b: any) => b.createdAt - a.createdAt));
  }, []);

  const calculateScore = (session: TestSession) => {
    const answers = session.userAnswers;
    let correct = 0;
    const total = session.questionCount;
    
    // In a real app, we'd fetch actual answers. For mock, we check against MOCK_QUESTIONS
    // Simplified for demo:
    return {
      percent: 75, // Mock fixed score for UI
      correct: Math.floor(total * 0.75),
      total
    };
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-primary">Test History</h1>
          <p className="text-muted-foreground mt-1">Review your past performance and study incorrect answers.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9 w-64" placeholder="Search topics..." />
          </div>
          <Button variant="outline" size="icon">
            <Filter className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {sessions.length === 0 ? (
        <Card className="p-12 text-center bg-white/50 border-dashed">
          <div className="flex flex-col items-center gap-4">
            <div className="p-4 bg-muted rounded-full">
              <Calendar className="w-8 h-8 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-xl font-bold">No sessions yet</h3>
              <p className="text-muted-foreground mt-1 max-w-sm mx-auto">
                Start your first practice test to begin tracking your progress and mastering the material.
              </p>
            </div>
            <Button asChild className="mt-2">
              <Link href="/create">Create Your First Test</Link>
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {sessions.map((session) => {
            const score = calculateScore(session);
            return (
              <Card key={session.id} className="overflow-hidden hover:shadow-md transition-shadow group border-l-4 border-l-primary">
                <CardContent className="p-0">
                  <div className="flex flex-col md:flex-row items-center">
                    <div className="p-6 md:w-48 border-b md:border-b-0 md:border-r flex flex-col items-center justify-center bg-primary/5">
                      <div className="text-2xl font-black text-primary">{score.percent}%</div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mt-1">Accuracy</div>
                    </div>
                    
                    <div className="p-6 flex-1 grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="border-secondary text-secondary font-bold text-[10px]">
                            {session.mode}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(session.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        </div>
                        <h3 className="font-bold text-lg truncate">
                          {session.subjects.length > 0 ? session.subjects.join(', ') : 'Mixed Subjects'}
                        </h3>
                      </div>

                      <div className="flex items-center gap-8">
                        <div className="flex flex-col">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Duration
                          </span>
                          <span className="font-semibold">24m 12s</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-green-500" /> Correct
                          </span>
                          <span className="font-semibold">{score.correct} / {score.total}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-end">
                        <Button variant="ghost" className="group-hover:text-primary gap-2" asChild>
                          <Link href={`/test/${session.id}`}>
                            Review Questions
                            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                          </Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
