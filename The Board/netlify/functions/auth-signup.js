// Creates a new user account via Supabase Auth
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

  const { email, password } = JSON.parse(event.body || '{}');
  if (!email || !password) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email and password required' }) };

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) return { statusCode: 400, headers, body: JSON.stringify({ error: error.message }) };
  return { statusCode: 200, headers, body: JSON.stringify({ user: data.user }) };
};
