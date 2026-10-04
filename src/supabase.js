import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

function validProjectUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.pathname === '/' && !parsed.search && !parsed.hash;
  } catch { return false; }
}

export const supabaseConfigIssue = !url
  ? 'Set EXPO_PUBLIC_SUPABASE_URL in mobile/.env.'
  : url.includes('your-project') || !validProjectUrl(url)
    ? 'Set EXPO_PUBLIC_SUPABASE_URL to your HTTPS Supabase project root URL.'
    : !anonKey
      ? 'Set EXPO_PUBLIC_SUPABASE_ANON_KEY in mobile/.env.'
      : anonKey.includes('your-supabase')
        ? 'Set EXPO_PUBLIC_SUPABASE_ANON_KEY to your Supabase anon or publishable key.'
      : null;

export const supabase = supabaseConfigIssue ? null : createClient(url, anonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

if (supabase) {
  if (AppState.currentState === 'active') supabase.auth.startAutoRefresh();
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
