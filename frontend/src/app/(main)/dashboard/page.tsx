"use client";

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Trophy, 
  Target, 
  Clock, 
  Flame, 
  TrendingUp, 
  ArrowRight,
  BrainCircuit,
  PlusCircle
} from 'lucide-react';
import { 
  Bar, 
  BarChart, 
  ResponsiveContainer, 
  XAxis, 
  YAxis, 
  Tooltip, 
  Cell 
} from 'recharts';
import Link from 'next/link';
import { cn } from '@/lib/utils';

const PERFORMANCE_DATA = [
  { name: 'Biology', score: 85, fill: 'hsl(var(--chart-1))' },
  { name: 'Chemistry', score: 62, fill: 'hsl(var(--chart-2))' },
  { name: 'Physics', score: 45, fill: 'hsl(var(--chart-3))' },
  { name: 'Psychology', score: 92, fill: 'hsl(var(--chart-4))' },
  { name: 'Sociology', score: 78, fill: 'hsl(var(--chart-5))' },
];

export default function DashboardPage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-primary">Welcome back, Alex</h1>
          <p className="text-muted-foreground mt-1">You've mastered 68% of the curriculum. Keep it up!</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/review">View History</Link>
          </Button>
          <Button asChild>
            <Link href="/create" className="flex items-center gap-2">
              <PlusCircle className="w-4 h-4" />
              Start New Session
            </Link>
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white/50 border-primary/10 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Overall Mastery</p>
                <h3 className="text-2xl font-bold mt-1">68.4%</h3>
              </div>
              <div className="p-2 bg-primary/10 rounded-full">
                <Trophy className="w-5 h-5 text-primary" />
              </div>
            </div>
            <Progress value={68.4} className="h-1.5 mt-4" />
          </CardContent>
        </Card>

        <Card className="bg-white/50 border-secondary/10 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Questions Solved</p>
                <h3 className="text-2xl font-bold mt-1">1,248</h3>
              </div>
              <div className="p-2 bg-secondary/10 rounded-full">
                <Target className="w-5 h-5 text-secondary" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4 flex items-center gap-1">
              <TrendingUp className="w-3 h-3 text-green-500" />
              <span className="text-green-500 font-semibold">+24</span> from yesterday
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white/50 border-orange-100 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Study Streak</p>
                <h3 className="text-2xl font-bold mt-1">12 Days</h3>
              </div>
              <div className="p-2 bg-orange-50 rounded-full">
                <Flame className="w-5 h-5 text-orange-500" />
              </div>
            </div>
            <div className="flex gap-1 mt-4">
              {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                <div key={i} className={cn("flex-1 h-1.5 rounded-full", i < 6 ? "bg-orange-500" : "bg-muted")} />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/50 border-blue-100 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Time Today</p>
                <h3 className="text-2xl font-bold mt-1">2h 15m</h3>
              </div>
              <div className="p-2 bg-blue-50 rounded-full">
                <Clock className="w-5 h-5 text-blue-500" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4">Goal: 3 hours per day</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card className="lg:col-span-2 shadow-md">
          <CardHeader>
            <CardTitle>Subject Performance</CardTitle>
            <CardDescription>Accuracy percentage across main topic areas</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={PERFORMANCE_DATA}>
                  <XAxis 
                    dataKey="name" 
                    stroke="hsl(var(--muted-foreground))" 
                    fontSize={12} 
                    tickLine={false} 
                    axisLine={false} 
                  />
                  <YAxis 
                    stroke="hsl(var(--muted-foreground))" 
                    fontSize={12} 
                    tickLine={false} 
                    axisLine={false} 
                    tickFormatter={(value) => `${value}%`}
                  />
                  <Tooltip 
                    cursor={{fill: 'hsl(var(--muted)/0.3)'}}
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="bg-white border rounded-lg p-3 shadow-lg">
                            <p className="font-bold text-primary">{payload[0].payload.name}</p>
                            <p className="text-sm text-muted-foreground">Accuracy: <span className="text-secondary font-bold">{payload[0].value}%</span></p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                    {PERFORMANCE_DATA.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="shadow-md">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Recent Insights</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-green-50 border border-green-100">
                <TrendingUp className="w-5 h-5 text-green-600 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-green-900">Strong: Biology</p>
                  <p className="text-xs text-green-700">You&apos;ve maintained &gt;90% accuracy in Cell Biology for 3 days.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-red-50 border border-red-100">
                <BrainCircuit className="w-5 h-5 text-red-600 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-900">Review: Physics</p>
                  <p className="text-xs text-red-700">Classical Mechanics accuracy has dipped. Consider a targeted test.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-md border-primary/20 bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg text-primary">Next Milestone</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">Complete 50 more questions to unlock the "Question Wizard" badge.</p>
              <Button className="w-full group" asChild>
                <Link href="/create">
                  Start Learning
                  <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
