import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import type { Todo } from '@/lib/todos';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');

  if (!userId) {
    return new NextResponse('Missing userId', { status: 400 });
  }

  if (!supabaseAdmin) {
    return new NextResponse('Server configuration error', { status: 500 });
  }

  const { data, error } = await supabaseAdmin
    .from('todos')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    console.error('Calendar feed error:', error);
    return new NextResponse('Database error', { status: 500 });
  }

  const todos = (data ?? []) as Todo[];

  // Generate iCalendar format
  const now = new Date();
  const dtstamp = formatDateIcs(now);

  let ics = `BEGIN:VCALENDAR\r\n`;
  ics += `VERSION:2.0\r\n`;
  ics += `PRODID:-//PassBar//Study Plan//EN\r\n`;
  ics += `CALSCALE:GREGORIAN\r\n`;
  ics += `METHOD:PUBLISH\r\n`;
  ics += `X-WR-CALNAME:PassBar Study Plan\r\n`;
  ics += `X-WR-TIMEZONE:UTC\r\n`;

  for (const todo of todos) {
    if (!todo.due_date) continue;

    const dueDate = new Date(todo.due_date);
    
    const dtstart = formatDateIcsDateOnly(dueDate);
    
    // For all-day events, DTEND is exclusive, so it should be the next day
    const endDate = new Date(dueDate);
    endDate.setDate(endDate.getDate() + 1);
    const dtend = formatDateIcsDateOnly(endDate);
    
    ics += `BEGIN:VEVENT\r\n`;
    ics += `UID:${todo.id}@passbar.app\r\n`;
    ics += `DTSTAMP:${dtstamp}\r\n`;
    ics += `DTSTART;VALUE=DATE:${dtstart}\r\n`;
    ics += `DTEND;VALUE=DATE:${dtend}\r\n`;
    
    const prefix = todo.status === 'completed' ? '✅ ' : '🗓️ ';
    ics += `SUMMARY:${escapeIcsText(prefix + todo.title)}\r\n`;
    
    let description = `Type: ${todo.type}\\nStatus: ${todo.status}`;
    if (todo.chapter_ids) {
        description += `\\n\\nLink: https://passbar.app/create?chapters=${encodeURIComponent(todo.chapter_ids)}`;
    }
    ics += `DESCRIPTION:${escapeIcsText(description)}\r\n`;
    
    ics += `END:VEVENT\r\n`;
  }

  ics += `END:VCALENDAR\r\n`;

  return new NextResponse(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="passbar-plan.ics"',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}

function formatDateIcs(date: Date) {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function formatDateIcsDateOnly(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function escapeIcsText(text: string) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}
