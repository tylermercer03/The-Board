const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

  const { timeMin, timeMax } = event.queryStringParameters || {};
  console.log('gcal-events called, timeMin:', timeMin, 'timeMax:', timeMax);

  if (!timeMin || !timeMax) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'timeMin and timeMax required' }) };
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  console.log('Supabase URL:', process.env.SUPABASE_URL ? 'set' : 'MISSING');
  console.log('Service key:', process.env.SUPABASE_SERVICE_KEY ? 'set' : 'MISSING');

  const { data: row, error: sbError } = await sb
    .from('user_settings')
    .select('value')
    .eq('key', 'gcal_tokens')
    .single();

  if (sbError) {
    console.log('Supabase error:', sbError.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'supabase_error: ' + sbError.message }) };
  }

  if (!row?.value?.access_token) {
    console.log('No tokens found in user_settings');
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'not_connected' }) };
  }

  console.log('Tokens found, expires_at:', row.value.expires_at, 'now:', Date.now());
  let { access_token, refresh_token, expires_at } = row.value;

  if (Date.now() > expires_at - 60000) {
    console.log('Token expired, refreshing...');
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
      if (refreshed.error) throw new Error(refreshed.error_description || refreshed.error);
      access_token = refreshed.access_token;
      expires_at = Date.now() + refreshed.expires_in * 1000;
      await sb.from('user_settings').upsert({
        key: 'gcal_tokens',
        value: { access_token, refresh_token, expires_at },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
      console.log('Token refreshed successfully');
    } catch (e) {
      console.log('Token refresh failed:', e.message);
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'token_refresh_failed: ' + e.message }) };
    }
  }

  try {
    // Get all calendars
    const calListRes = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      { headers: { Authorization: 'Bearer ' + access_token } }
    );
    const calList = await calListRes.json();
    if (calList.error) {
      console.log('Calendar list error:', calList.error.message);
      throw new Error(calList.error.message);
    }

    const calendars = (calList.items || []).filter(cal =>
      cal.selected !== false && cal.accessRole !== 'freeBusyReader'
    );
    console.log('Calendars found:', calendars.map(c => c.summary).join(', '));

    const params = new URLSearchParams({
      timeMin, timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '50',
    });

    const calFetches = calendars.map(cal =>
      fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
        { headers: { Authorization: 'Bearer ' + access_token } }
      ).then(r => r.json()).then(data => {
        const count = (data.items || []).length;
        console.log('Calendar', cal.summary, ':', count, 'events');
        return {
          calName: cal.summary,
          color: cal.backgroundColor || '#378add',
          items: data.items || [],
        };
      }).catch(e => {
        console.log('Error fetching calendar', cal.summary, ':', e.message);
        return { calName: cal.summary, color: '#378add', items: [] };
      })
    );

    const results = await Promise.all(calFetches);

    const events = [];
    results.forEach(({ calName, color, items }) => {
      items.forEach(ev => {
        const startDT = ev.start?.dateTime || ev.start?.date;
        const endDT = ev.end?.dateTime || ev.end?.date;
        const isAllDay = !ev.start?.dateTime;
        events.push({
          id: ev.id,
          title: ev.summary || '(No title)',
          calendar: calName,
          color,
          start_time: isAllDay ? '00:00' : timeOnly(startDT),
          end_time: isAllDay ? '23:59' : timeOnly(endDT),
          event_date: dateOnly(startDT),
          gcal_id: ev.id,
          all_day: isAllDay,
          notes: ev.description || '',
        });
      });
    });

    events.sort((a, b) => a.start_time.localeCompare(b.start_time));
    console.log('Total events returning:', events.length);

    return { statusCode: 200, headers, body: JSON.stringify({ events }) };
  } catch (e) {
    console.log('Fatal error:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};

function timeOnly(dt) {
  if (!dt) return '00:00';
  if (dt.includes('T')) return dt.split('T')[1].slice(0, 5);
  return '00:00';
}

function dateOnly(dt) {
  if (!dt) return '';
  return dt.split('T')[0];
}
