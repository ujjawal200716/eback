import { createClient } from '@supabase/supabase-js';

// ⚠️ REPLACE WITH YOUR ACTUAL SUPABASE KEYS
const supabaseUrl = 'https://zlzdtzkprmgbixxggkrz.supabase.co';
const supabaseKey = 'sb_publishable_tK1j5PaFwiZW5JyQkygNzw_nYxgwzqW';

export const supabase = createClient(supabaseUrl, supabaseKey);