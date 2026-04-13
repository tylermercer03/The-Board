const { createClient } = require('@supabase/supabase-js');

// Convert a Google Calendar datetime string to Pacific Time HH:MM
function toPacificTime(dtString, isAllDay) {
  if (!dtString || isAllDay) return null;
  
  // Parse the datetime - Google returns ISO format with timezone offset
  // e.g. "2026-04-12T14:00:00-07:00" or "2026-04-12T21:00:00Z"
  const date = new Date(dtString);
  
  // Format in Pacific Time
  const pst = date.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  
  // toLocaleString returns "HH:MM" but sometimes "24:MM" for midnight
  const [h, m] = pst.split(':').map(Number);
  const hour = h === 24 ? 0 : h;
  return String(hour).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// Get the date in Pacific Time for a given datetime string
function toPacificDate(dtString, isAllDay) {
  if (!dtString) return '';
  
  if (isAllDay) {
    // All-day events use date-only strings like "2026-04-12"
    // Return as-is - these are calendar dates without timezone
    return dtString.split('T')[0];
  }
  
  const date = new Date(dtString);
  
  // Get the date in Pacific Time
  const parts = date.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).split('/');
  
  // Returns MM/DD/YYYY, convert to YYYY-MM-DD
  return `${parts[2]}-${parts[0]}-${parts[1]}`;
}

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

  const { data: row, error: sbError } = await sb
    .from('user_settings')
    .select('value')
    .eq('key', 'gcal_tokens')
    .single();

  if (sbError || !row?.value?.access_token) {
    console.log('No tokens found:', sbError?.message);
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'not_connected' }) };
  }

  let { access_token, refresh_token, expires_at } = row.value;

  // Refresh token if expired
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
    if (calList.error) throw new Error(calList.error.message);

    const calendars = (calList.items || []).filter(cal =>
      cal.selected !== false && cal.accessRole !== 'freeBusyReader'
    );
    console.log('Calendars found:', calendars.map(c => c.summary).join(', '));

    const params = new URLSearchParams({
      timeMin,
      timeMax,
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
        const isAllDay = !ev.start?.dateTime;
        const startDT = ev.start?.dateTime || ev.start?.date;
        const endDT   = ev.end?.dateTime   || ev.end?.date;

        // Convert to Pacific Time
        const startTime = toPacificTime(startDT, isAllDay);
        const endTime   = toPacificTime(endDT,   isAllDay);
        const eventDate = toPacificDate(startDT,  isAllDay);

        console.log(`Event: ${ev.summary} | raw: ${startDT} | pacific date: ${eventDate} | pacific time: ${startTime}-${endTime} | allDay: ${isAllDay}`);

        events.push({
          id: ev.id,
          title: ev.summary || '(No title)',
          calendar: calName,
          color,
          start_time: startTime || '00:00',
          end_time:   endTime   || '23:59',
          event_date: eventDate,
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
