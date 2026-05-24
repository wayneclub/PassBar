"use client";

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend } from 'recharts';

const DATA = [
  { name: 'Wk 1', biology: 4000, chemistry: 2400, physics: 2400 },
  { name: 'Wk 2', biology: 3000, chemistry: 1398, physics: 2210 },
  { name: 'Wk 3', biology: 2000, chemistry: 9800, physics: 2290 },
  { name: 'Wk 4', biology: 2780, chemistry: 3908, physics: 2000 },
];

export default function PerformanceDetail() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-3xl font-bold text-primary">Performance Analytics</h1>
          <p className="text-muted-foreground">Detailed breakdown of your strengths and opportunities.</p>
        </header>
        <div className="grid grid-cols-1 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Subject Progress over Time</CardTitle>
              <CardDescription>Questions answered per week by category</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[400px] w-full bg-muted/10 animate-pulse rounded-md" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-primary">Performance Analytics</h1>
        <p className="text-muted-foreground">Detailed breakdown of your strengths and opportunities.</p>
      </header>

      <div className="grid grid-cols-1 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Subject Progress over Time</CardTitle>
            <CardDescription>Questions answered per week by category</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[400px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={DATA}>
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="biology" fill="hsl(var(--chart-1))" />
                  <Bar dataKey="chemistry" fill="hsl(var(--chart-2))" />
                  <Bar dataKey="physics" fill="hsl(var(--chart-3))" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
