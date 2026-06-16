import { supabase } from './supabase';

async function test() {
  const { data, error } = await supabase
    .from('todos')
    .insert({
      user_id: '123',
      title: `Test`,
      status: 'new',
      type: 'practice',
      chapter_id: 'test_id',
      chapter_ids: 'test_id',
      auto_generated: false,
      due_date: new Date().toISOString(),
    })
    .select()
    .single();
  console.log(data, error);
}
test();
