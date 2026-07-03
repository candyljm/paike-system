// Vercel Serverless Function - 飞书多维表格 API 代理
// 使用飞书自建应用（App ID + App Secret）获取 tenant_access_token
// 个人版/免费版飞书均可使用
// 兼容两种调用方式：
//   1. POST body: { path, method, body } （前端默认方式）
//   2. Header: X-Request-Path + X-Request-Method

// 内存缓存 token（避免每次请求都重新获取）
let tokenCache = {
  token: '',
  expireTime: 0
};

// 获取 tenant_access_token（带缓存）
async function getTenantAccessToken() {
  const now = Date.now();
  
  // 如果 token 还在有效期内（提前5分钟过期，防止边界情况），直接返回缓存
  if (tokenCache.token && now < tokenCache.expireTime - 5 * 60 * 1000) {
    return tokenCache.token;
  }
  
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  
  if (!appId || !appSecret) {
    throw new Error('请在 Vercel 环境变量中配置 FEISHU_APP_ID 和 FEISHU_APP_SECRET');
  }
  
  const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify({
      app_id: appId,
      app_secret: appSecret
    })
  });
  
  const data = await response.json();
  
  if (data.code !== 0) {
    throw new Error('获取 token 失败: ' + data.msg + ' (code: ' + data.code + ')。请检查 App ID 和 App Secret 是否正确。');
  }
  
  // 缓存 token
  tokenCache.token = data.tenant_access_token;
  tokenCache.expireTime = now + data.expire * 1000;
  
  return data.tenant_access_token;
}

export default async function handler(req, res) {
  // CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Path, X-Request-Method');
  
  // 预检请求
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  try {
    const token = await getTenantAccessToken();
    
    // 从 POST body 或 header 获取目标路径和方法
    let targetPath = '';
    let targetMethod = 'GET';
    let targetBody = null;
    
    if (req.method === 'POST' && req.body) {
      // 方式1：POST body 传参（前端默认方式）
      targetPath = req.body.path || '';
      targetMethod = req.body.method || 'GET';
      targetBody = req.body.body || null;
    } else {
      // 方式2：Header 传参
      targetPath = req.headers['x-request-path'] || req.query.path || '';
      targetMethod = req.headers['x-request-method'] || req.method;
      if (req.body && Object.keys(req.body).length > 0) {
        targetBody = req.body;
      }
    }
    
    if (!targetPath) {
      res.status(400).json({ error: '缺少目标路径，请在 body.path 或 X-Request-Path 请求头中指定' });
      return;
    }
    
    // 构建飞书 API URL（自动补全 bitable/v1 前缀）
    const feishuBase = 'https://open.feishu.cn/open-apis';
    let fullPath = targetPath;
    if (targetPath.startsWith('/apps/')) {
      fullPath = '/bitable/v1' + targetPath;
    }
    const url = feishuBase + fullPath;
    
    // 构建请求选项
    const options = {
      method: targetMethod,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json; charset=utf-8'
      }
    };
    
    // 如果有请求体，带上
    if (targetBody && targetMethod !== 'GET') {
      options.body = JSON.stringify(targetBody);
    }
    
    // 发起请求
    const response = await fetch(url, options);
    const result = await response.json();
    
    // 返回结果
    res.status(response.status).json(result);
    
  } catch (error) {
    console.error('飞书 API 代理错误:', error);
    res.status(500).json({
      error: error.message || '代理请求失败',
      msg: error.message || '代理请求失败',
      code: -1
    });
  }
}
