// netlify/functions/gcal-callback.js
// Google redirects here after the user approves access.
// Exchanges the auth code for tokens and stores them in Supabase.

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const { code, error } = event.queryStringParameters || {};

  if (error) {
    return redirect('/?gcal=error&reason=' + encodeURIComponent(error));
  }

  if (!code) {
    return redirect('/?gcal=error&reason=no_code');
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.URL + '/.netlify/functions/gcal-callback';

  // Exchange auth code for tokens
  let tokens;
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    tokens = await res.json();
    if (tokens.error) throw new Error(tokens.error_description || tokens.error);
  } catch (e) {
    return redirect('/?gcal=error&reason=' + encodeURIComponent(e.message));
  }

  // Store tokens in Supabase
  try {
    const sb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY // use service key here (server-side only)
    );

    await sb.from('user_settings').upsert({
      key: 'gcal_tokens',
      value: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Date.now() + tokens.expires_in * 1000,
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
  } catch (e) {
    return redirect('/?gcal=error&reason=supabase_' + encodeURIComponent(e.message));
  }

  return redirect('/?gcal=connected');
};

function redirect(url) {
  return { statusCode: 302, headers: { Location: url } };
}
