/* ──────────────────────────────────────────────────────────────
 *  worker.js  ·  Cloudflare Module Worker
 * ──────────────────────────────────────────────────────────────
 *  · 客户端: Authorization: Bearer <key>  +  JSON (默认带 stream:true)
 *  · Worker: Bearer → x-api-key, JSON → multipart
 *  · 返回: 若 stream:true ➜ 伪 SSE；否则返回整包 JSON
 *  · 自动解包上游 content.text
 *  · 全局 CORS
 * ────────────────────────────────────────────────────────────── */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    
    /* CORS 预检 */
    if (req.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: CORS });
    
    /* 处理 /v1/models 路由 */
    if (url.pathname === '/v1/models') {
      if (req.method !== 'GET')
        return new Response('Method Not Allowed', { status: 405, headers: CORS });
      
      const modelsResponse = [
        {
          "id": "llama4-maverick",
          "object": "model",
          "created": 1746682848,
          "owned_by": "llama4"
        },
        {
          "id": "gpt-4.1-nano",
          "object": "model",
          "created": 1746682848,
          "owned_by": "llama4"
        },
        {
          "id": "qwen-3-32-b",
          "object": "model",
          "created": 1746682848,
          "owned_by": "llama4"
        },
        {
          "id": "nemotron-ultra",
          "object": "model",
          "created": 1746682848,
          "owned_by": "llama4"
        },
      ];
      
      return new Response(JSON.stringify(modelsResponse), {
        status: 200,
        headers: { ...CORS, 'content-type': 'application/json' },
      });
    }
    
    /* 处理 /v1/chat/completions 路由 */
    if (url.pathname === '/v1/chat/completions') {
      if (req.method !== 'POST')
        return new Response('Method Not Allowed', { status: 405, headers: CORS });

      /* 解析 JSON */
      let body;
      try {
        body = await req.json();
      } catch {
        return new Response('Invalid JSON body', { status: 400, headers: CORS });
      }
      if (!Array.isArray(body?.messages))
        return new Response('"messages" array is required', {
          status: 400,
          headers: CORS,
        });

      /* 取 Bearer key */
      let key;
      const auth = req.headers.get('Authorization') || req.headers.get('authorization');
      if (auth?.startsWith('Bearer ')) key = auth.slice(7).trim();
      if (!key) key = env.UPSTREAM_API_KEY;
      if (!key) return new Response('Missing API key', { status: 401, headers: CORS });

      /* 组装 multipart/form‑data（始终 full_response=true） */
      const fd = new FormData();
      fd.append('messages', JSON.stringify(body.messages));
      fd.append('model', body.model ?? 'qwen-3-32-b');
      fd.append('full_response', 'true');

      /* 向上游发送 */
      const upstream = await fetch('https://rad.huddlz.xyz/v1/chat/completions', {
        method: 'POST',
        headers: { 'x-api-key': key },
        body: fd,
      });

      /* 解析上游 JSON，解包 content.text */
      let data;
      try {
        data = await upstream.json();
        for (const c of data.choices ?? []) {
          const s = c?.message?.content;
          if (typeof s === 'string') {
            try {
              const inner = JSON.parse(s);
              if (typeof inner?.text === 'string') c.message.content = inner.text;
            } catch {/* not JSON */}
          }
        }
      } catch {
        /* 上游异常 */
        return new Response(await upstream.text(), {
          status: upstream.status,
          headers: { ...CORS, 'content-type': 'text/plain' },
        });
      }

      /* 若客户端请求 stream:true —— 伪装成 SSE 流 */
      if (body.stream === true) {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            /* chunk 1: role */
            const roleChunk = {
              id: data.id,
              object: 'chat.completion.chunk',
              created: data.created,
              model: data.model,
              choices: [{ index: 0, delta: { role: 'assistant' } }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(roleChunk)}\n\n`));

            /* chunk 2: full content */
            const contentText = data.choices?.[0]?.message?.content ?? '';
            const contentChunk = {
              id: data.id,
              object: 'chat.completion.chunk',
              created: data.created,
              model: data.model,
              choices: [{ index: 0, delta: { content: contentText }, finish_reason: 'stop' }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(contentChunk)}\n\n`));

            /* chunk 3: [DONE] */
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            ...CORS,
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          },
        });
      }

      /* 非 stream — 直接回整包 JSON */
      return new Response(JSON.stringify(data), {
        status: upstream.status,
        headers: { ...CORS, 'content-type': 'application/json' },
      });
    }
    
    /* 其他路由返回 404 */
    return new Response('Not Found', { status: 404, headers: CORS });
  },
};

export const config = { 
  path: ['/v1/chat/completions', '/v1/models'] 
};
