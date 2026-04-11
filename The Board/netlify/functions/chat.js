exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  console.log('API key present:', !!apiKey, 'length:', apiKey ? apiKey.length : 0);

  if (!apiKey) {
    console.log('ERROR: ANTHROPIC_API_KEY not set');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) {
    console.log('JSON parse error:', e.message);
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  console.log('Calling Anthropic, messages count:', body.messages ? body.messages.length : 0);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: body.model || 'claude-sonnet-4-20250514',
        max_tokens: body.max_tokens || 1000,
        system: body.system,
        messages: body.messages,
      }),
    });

    console.log('Anthropic response status:', response.status);
    const data = await response.json();
    console.log('Response type:', data.type, 'error:', data.error ? JSON.stringify(data.error) : 'none');
    return { statusCode: response.status, headers, body: JSON.stringify(data) };
  } catch (e) {
    console.log('Fetch error:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
