// netlify/functions/gcal-create.js
// Creates a new event in Google Calendar and updates Supabase with the gcal_id.

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid json' }) }; }

  const { title, event_date, start_time, end_time, notes } = body;
  if (!title || !event_date) return { statusCode: 400, headers, body: JSON.stringify({ error: 'title and event_date required' }) };

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const { data: row } = await sb.from('user_settings').select('value').eq('key', 'gcal_tokens').single();
  if (!row?.value?.access_token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'not_connected' }) };

  const { access_token } = row.value;

  const startDT = start_time ? event_date + 'T' + start_time + ':00' : event_date;
  const endDT   = end_time   ? event_date + 'T' + end_time   + ':00' : event_date;
  const isAllDay = !start_time;

  const gcalEvent = {
    summary: title,
    description: notes || '',
    ...(isAllDay
      ? { start: { date: event_date }, end: { date: event_date } }
      : { start: { dateTime: startDT, timeZone: 'America/Los_Angeles' }, end: { dateTime: endDT, timeZone: 'America/Los_Angeles' } }
    ),
  };

  try {
    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      { method: 'POST', headers: { Authorization: 'Bearer ' + access_token, 'Content-Type': 'application/json' }, body: JSON.stringify(gcalEvent) }
    );
    const created = await res.json();
    if (created.error) throw new Error(created.error.message);

    return { statusCode: 200, headers, body: JSON.stringify({ gcal_id: created.id }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
