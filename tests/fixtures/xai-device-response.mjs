globalThis.fetch = async (input) => {
  const url = String(input);
  if (url === 'https://auth.x.ai/oauth2/device/code') {
    return Response.json({
      device_code: 'synthetic-device',
      user_code: 'EXAMPLE-1234',
      verification_uri: 'https://example.test/device',
      interval: 0.001,
      expires_in: 60
    });
  }
  if (url === 'https://auth.x.ai/oauth2/token') {
    return Response.json({
      access_token: 'synthetic-access',
      refresh_token: 'synthetic-refresh',
      expires_in: 3600
    });
  }
  throw new Error(`Unexpected OAuth request: ${url}`);
};
