import { Router } from 'itty-router';
import { LoadBalancer, STRATEGIES } from './loadBalancer';

// 创建路由器
const router = Router();

// 创建负载均衡器实例
let loadBalancer;

// 设置CORS头
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-KEY',
};

// 处理OPTIONS请求（预检请求）
router.options('*', async request => {
  return new Response(null, {
    headers: corsHeaders,
    status: 200,
  });
});

// 验证API密钥
async function validateApiKey(request, env) {
  // 从请求头获取API密钥
  const apiKey = request.headers.get('Authorization')?.replace('Bearer ', '') || 
                 request.headers.get('X-API-KEY');
  
  // 如果没有提供API密钥，拒绝请求
  if (!apiKey) {
    return false;
  }
  
  // 只接受与环境变量中设置的API_KEY匹配的请求
  const configuredApiKey = env.API_KEY || 'your-secret-api-key-here';
  return apiKey === configuredApiKey;
}

// 初始化负载均衡器
function initLoadBalancer(env) {
  // 定义默认提供商
  const defaultProvider = {
    id: 'fireworks',
    baseUrl: env.DEFAULT_OPENAI_PROVIDER || 'https://api.fireworks.ai/inference',
    token: env.DEFAULT_OPENAI_TOKEN || 'fw_3ZLxTc6tHATsi4yBobZVtjv8',
    weight: 1,
  };
  
  // 创建负载均衡器实例
  loadBalancer = new LoadBalancer([defaultProvider], STRATEGIES.ROUND_ROBIN);
  
  // 尝试从环境变量添加更多提供商（如果存在）
  if (env.ADDITIONAL_PROVIDERS) {
    try {
      const additionalProviders = JSON.parse(env.ADDITIONAL_PROVIDERS);
      if (Array.isArray(additionalProviders)) {
        additionalProviders.forEach(provider => {
          if (provider.id && provider.baseUrl && provider.token) {
            loadBalancer.addProvider(provider);
          }
        });
      }
    } catch (error) {
      console.error('Error parsing additional providers:', error);
    }
  }
  
  return loadBalancer;
}

// 获取目标API
function getTargetAPI(env) {
  // 确保负载均衡器已初始化
  if (!loadBalancer) {
    initLoadBalancer(env);
  }
  
  // 获取下一个提供商
  const provider = loadBalancer.getNextProvider();
  
  if (!provider) {
    // 如果没有提供商可用，返回默认值
    return {
      baseUrl: env.DEFAULT_OPENAI_PROVIDER || 'https://api.fireworks.ai/inference',
      token: env.DEFAULT_OPENAI_TOKEN || 'fw_3ZLxTc6tHATsi4yBobZVtjv8',
    };
  }
  
  return {
    baseUrl: provider.baseUrl,
    token: provider.token,
  };
}

// 转发请求到目标API
async function forwardRequest(request, env, path) {
  try {
    const { baseUrl, token } = getTargetAPI(env);
    const url = `${baseUrl}${path}`;
    
    // 克隆请求
    const requestHeaders = new Headers(request.headers);
    
    // 替换授权头
    requestHeaders.set('Authorization', `Bearer ${token}`);
    
    // 从请求中移除Host头以防止潜在问题
    requestHeaders.delete('Host');
    
    // 创建转发请求
    const forwardRequest = new Request(url, {
      method: request.method,
      headers: requestHeaders,
      body: request.body,
      redirect: 'follow',
    });
    
    // 发送请求到目标API
    const response = await fetch(forwardRequest);
    
    // 检查流式响应
    const isStreamResponse = response.headers.get('content-type')?.includes('text/event-stream');
    
    if (isStreamResponse) {
      // 处理流式响应
      const { readable, writable } = new TransformStream();
      const responseBody = response.body;
      
      // 如果响应体存在，转发流
      if (responseBody) {
        responseBody.pipeTo(writable).catch(error => {
          console.error('Stream processing error:', error);
        });
      }
      
      // 设置响应头
      const responseHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders)) {
        responseHeaders.set(key, value);
      }
      
      return new Response(readable, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } else {
      // 处理非流式响应
      const responseData = await response.text();
      
      // 设置响应头
      const responseHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders)) {
        responseHeaders.set(key, value);
      }
      
      return new Response(responseData, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    }
  } catch (error) {
    // 处理错误
    console.error('Proxy error:', error);
    return new Response(JSON.stringify({ error: 'Proxy error', message: error.message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    });
  }
}

// 代理所有OpenAI API端点
router.all('/v1/*', async (request, env) => {
  // 验证API密钥
  const isValidApiKey = await validateApiKey(request, env);
  if (!isValidApiKey) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    });
  }
  
  // 获取请求路径
  const url = new URL(request.url);
  const path = url.pathname;
  
  // 转发请求
  return forwardRequest(request, env, path);
});

// 添加健康检查端点
router.get('/health', async () => {
  return new Response(JSON.stringify({ status: 'ok' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
});

// 添加负载均衡状态端点
router.get('/stats', async (request, env) => {
  // 验证API密钥
  const isValidApiKey = await validateApiKey(request, env);
  if (!isValidApiKey) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    });
  }
  
  // 确保负载均衡器已初始化
  if (!loadBalancer) {
    initLoadBalancer(env);
  }
  
  // 获取使用统计信息
  const stats = {
    strategy: loadBalancer.strategy,
    providers: loadBalancer.providers.map(provider => ({
      id: provider.id,
      baseUrl: provider.baseUrl,
      usage: loadBalancer.getUsageStats()[provider.id] || 0,
    })),
  };
  
  return new Response(JSON.stringify(stats), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
});

// 添加根路径重定向
router.get('/', async () => {
  return new Response('OpenAI API Proxy is running!', {
    headers: {
      'Content-Type': 'text/plain',
      ...corsHeaders,
    },
  });
});

// 处理404错误
router.all('*', async () => {
  return new Response(JSON.stringify({ error: 'Not Found' }), {
    status: 404,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
});

// 导出fetch事件处理程序
export default {
  async fetch(request, env, ctx) {
    // 确保负载均衡器已初始化
    if (!loadBalancer) {
      initLoadBalancer(env);
    }
    return router.handle(request, env, ctx);
  },
}; 