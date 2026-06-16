import { supabase } from './supabase.ts';

async function test() {
  const { data, error } = await supabase
    .from('todos')
    .insert({
      user_id: '00000000-0000-0000-0000-000000000000',
      title: 'Test',
      status: 'new',
      type: 'practice',
      chapter_id: '1',
      chapter_ids: '1',
      auto_generated: false,
      due_date: new Date().toISOString(),
    })
    .select()
    .single();
  console.log("Error:", error);
}
test();
