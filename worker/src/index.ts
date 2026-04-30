export default {
  async fetch(request: Request, env: any): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Expected POST', { status: 405 });
    }

    try {
      const anthropicApiKey = env.ANTHROPIC_API_KEY;

      if (!anthropicApiKey) {
        return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const body = await request.json();
      const apiUrl = 'https://api.anthropic.com/v1/messages';

      const anthropicRequest = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      };

      const anthropicResponse = await fetch(apiUrl, anthropicRequest);

      // Return the streaming response from Anthropic directly to the client
      return new Response(anthropicResponse.body, {
        status: anthropicResponse.status,
        statusText: anthropicResponse.statusText,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });

    } catch (error: any) {
      console.error('Error in worker:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
