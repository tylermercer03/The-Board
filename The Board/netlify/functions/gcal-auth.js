// netlify/functions/gcal-auth.js
// Redirects the user to Google's OAuth consent screen

exports.handler = async (event) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.URL + '/.netlify/functions/gcal-callback';

  const scope = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events',
  ].join(' ');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope,
    access_type: 'offline',
    prompt: 'consent',
  });

  return {
    statusCode: 302,
    headers: {
      Location: 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString(),
    },
  };
};
