// netlify/functions/gcal-events.js
// Called by the app to fetch calendar events for a given date range.
// Also handles refreshing the access token if it has expired.

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  const { timeMin, timeMax } = event.queryStringParameters || {};
  if (!timeMin || !timeMax) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'timeMin and timeMax required' }) };
  }

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Load stored tokens
  const { data: row } = await sb
    .from('user_settings')
    .select('value')
    .eq('key', 'gcal_tokens')
    .single();

  if (!row?.value?.access_token) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'not_connected' }) };
  }

  let { access_token, refresh_token, expires_at } = row.value;

  // Refresh token if expired (with 60s buffer)
  if (Date.now() > expires_at - 60000) {
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          refresh_token,
          grant_type: 'refresh_token',
        }),
      });
      const refreshed = await res.json();
      if (refreshed.error) throw new Error(refreshed.error);
      access_token = refreshed.access_token;
      expires_at = Date.now() + refreshed.expires_in * 1000;
      await sb.from('user_settings').upsert({
        key: 'gcal_tokens',
        value: { access_token, refresh_token, expires_at },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    } catch (e) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'token_refresh_failed' }) };
    }
  }

  // Fetch events from Google Calendar
  try {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '50',
    });

    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?' + params,
      { headers: { Authorization: 'Bearer ' + access_token } }
    );
    const gcalData = await res.json();
    if (gcalData.error) throw new Error(gcalData.error.message);

    // Shape events for the app
    const events = (gcalData.items || []).map(ev => ({
      id: ev.id,
      title: ev.summary || '(No title)',
      start_time: timeOnly(ev.start?.dateTime || ev.start?.date),
      end_time: timeOnly(ev.end?.dateTime || ev.end?.date),
      event_date: dateOnly(ev.start?.dateTime || ev.start?.date),
      gcal_id: ev.id,
      notes: ev.description || '',
    }));

    return { statusCode: 200, headers, body: JSON.stringify({ events }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};

function timeOnly(dt) {
  if (!dt) return '00:00';
  if (dt.includes('T')) return dt.split('T')[1].slice(0, 5);
  return '00:00'; // all-day event
}

function dateOnly(dt) {
  if (!dt) return '';
  return dt.split('T')[0];
}
