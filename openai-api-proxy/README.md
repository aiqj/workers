# OpenAI API 代理服务

这是一个基于Cloudflare Workers的OpenAI API代理服务，可以将请求转发到兼容OpenAI API格式的第三方服务，如Fireworks AI。

## 功能特点

- 支持 OpenAI 格式的 API 请求转发
- 流式输出优化，支持聊天完成等流式响应
- 负载均衡，支持多个API提供商
- 基于API密钥的访问控制
- 完整的CORS支持，允许从任何源进行跨域请求
- 健康检查和统计信息端点

## 安装部署

### 前提条件

- [Node.js](https://nodejs.org/) (推荐 16.x 或更高版本)
- [Wrangler CLI](https://developers.cloudflare.com/workers/cli-wrangler/install-update)
- Cloudflare 账户

### 安装步骤

1. 克隆此仓库：

```bash
git clone https://github.com/yourusername/openai-api-proxy.git
cd openai-api-proxy
```

2. 安装依赖：

```bash
npm install
```

3. 修改 `wrangler.toml` 文件，根据需要更改配置：

```toml
name = "openai-api-proxy"
main = "src/index.js"
compatibility_date = "2023-12-01"

[vars]
DEFAULT_OPENAI_PROVIDER = "https://api.fireworks.ai/inference"
DEFAULT_OPENAI_TOKEN = "你的Fireworks API令牌"
# 可选：添加更多提供商的JSON配置
# ADDITIONAL_PROVIDERS = '[{"id":"provider2","baseUrl":"https://api.another-provider.com","token":"your-token"}]'
```

4. 部署到Cloudflare Workers：

```bash
npm run deploy
```

### 本地开发

运行本地开发服务器：

```bash
npm run dev
```

## 使用方法

部署后，您可以通过以下方式使用API：

### 身份验证

所有请求都需要通过以下方式之一进行身份验证：

1. 使用标准的Authorization头：
```
Authorization: Bearer your-api-key
```

2. 使用自定义X-API-KEY头：
```
X-API-KEY: your-api-key
```

API密钥可以是任意字符串，主要用于防止未经授权的访问。

### API端点

API代理支持所有OpenAI API端点，只需将您的请求发送到代理URL，后跟标准的OpenAI API路径：

```
https://your-worker-name.your-subdomain.workers.dev/v1/chat/completions
```

### 健康检查

您可以使用健康检查端点验证服务是否正常运行：

```
GET https://your-worker-name.your-subdomain.workers.dev/health
```

### 负载均衡统计

查看当前负载均衡状态和使用统计：

```
GET https://your-worker-name.your-subdomain.workers.dev/stats
```

## 示例：发送聊天请求

以下是一个使用代理发送聊天请求的示例：

```javascript
async function sendChatRequest() {
  const response = await fetch('https://your-worker-name.your-subdomain.workers.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer your-api-key' // 可以是任意值
    },
    body: JSON.stringify({
      model: 'accounts/fireworks/models/llama-v3-70b-instruct',
      messages: [
        { role: 'system', content: '你是一个有帮助的助手。' },
        { role: 'user', content: '你好，请简单介绍一下你自己。' }
      ],
      temperature: 0.7,
      stream: true // 支持流式输出
    })
  });

  // 处理流式响应
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      console.log(chunk);
    }
  } else {
    // 处理非流式响应
    const data = await response.json();
    console.log(data);
  }
}
```

## 配置多个API提供商

您可以通过设置环境变量 `ADDITIONAL_PROVIDERS` 来配置多个API提供商。这需要是一个包含提供商配置的JSON数组：

```json
[
  {
    "id": "fireworks",
    "baseUrl": "https://api.fireworks.ai/inference",
    "token": "fw_your_token",
    "weight": 1
  },
  {
    "id": "another-provider",
    "baseUrl": "https://api.another-provider.com",
    "token": "your-token",
    "weight": 1
  }
]
```

## 自定义负载均衡策略

默认使用轮询（round-robin）策略。您可以通过修改代码中的 `initLoadBalancer` 函数来更改负载均衡策略：

- `ROUND_ROBIN`：轮询，按顺序使用每个提供商
- `RANDOM`：随机选择提供商
- `LEAST_USED`：选择使用次数最少的提供商

## 许可证

MIT 