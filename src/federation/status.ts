import { createServer } from 'node:http';
import { logger } from '../lib/unjs-utils.js';

const PORT = process.env.STATUS_PORT || 4444;

interface SubgraphHealth {
  name: string;
  url: string;
  status: 'healthy' | 'unhealthy' | 'unknown';
  responseTime?: number;
  lastChecked: Date;
  error?: string;
}

interface FederationStatus {
  gateway: {
    status: 'healthy' | 'unhealthy';
    url: string;
  };
  subgraphs: SubgraphHealth[];
  lastUpdated: Date;
}

const SUBGRAPHS = [
  { name: 'user', url: process.env.USER_SUBGRAPH_URL || 'http://localhost:4001/graphql' },
  { name: 'todo', url: process.env.TODO_SUBGRAPH_URL || 'http://localhost:4002/graphql' },
  { name: 'ai', url: process.env.AI_SUBGRAPH_URL || 'http://localhost:4003/graphql' },
];

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4000/graphql';

async function checkSubgraphHealth(subgraph: { name: string; url: string }): Promise<SubgraphHealth> {
  const startTime = Date.now();
  
  try {
    const response = await fetch(subgraph.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' }),
    });
    
    const responseTime = Date.now() - startTime;
    
    if (response.ok) {
      const data = await response.json();
      if (data.data?.__typename === 'Query') {
        return {
          ...subgraph,
          status: 'healthy',
          responseTime,
          lastChecked: new Date(),
        };
      }
    }
    
    return {
      ...subgraph,
      status: 'unhealthy',
      responseTime,
      lastChecked: new Date(),
      error: `Invalid response: ${response.status}`,
    };
  } catch (error) {
    return {
      ...subgraph,
      status: 'unhealthy',
      lastChecked: new Date(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function checkGatewayHealth(): Promise<boolean> {
  try {
    const response = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' }),
    });
    
    if (response.ok) {
      const data = await response.json();
      return data.data?.__typename === 'Query';
    }
    return false;
  } catch {
    return false;
  }
}

async function getFederationStatus(): Promise<FederationStatus> {
  const [gatewayHealthy, ...subgraphHealths] = await Promise.all([
    checkGatewayHealth(),
    ...SUBGRAPHS.map(checkSubgraphHealth),
  ]);
  
  return {
    gateway: {
      status: gatewayHealthy ? 'healthy' : 'unhealthy',
      url: GATEWAY_URL,
    },
    subgraphs: subgraphHealths,
    lastUpdated: new Date(),
  };
}

function generateStatusHTML(status: FederationStatus): string {
  const statusColor = (s: string) => {
    switch (s) {
      case 'healthy': return '#4ade80';
      case 'unhealthy': return '#f87171';
      default: return '#fbbf24';
    }
  };
  
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Federation Status</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
      background: #f3f4f6;
    }
    .container {
      background: white;
      border-radius: 0.5rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      padding: 2rem;
    }
    h1 {
      margin: 0 0 2rem 0;
      color: #111827;
    }
    .status-grid {
      display: grid;
      gap: 1rem;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    }
    .status-card {
      border: 1px solid #e5e7eb;
      border-radius: 0.375rem;
      padding: 1.5rem;
    }
    .status-indicator {
      display: inline-block;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      margin-right: 0.5rem;
    }
    .status-header {
      display: flex;
      align-items: center;
      margin-bottom: 0.5rem;
    }
    .status-title {
      font-weight: 600;
      font-size: 1.125rem;
    }
    .status-url {
      color: #6b7280;
      font-size: 0.875rem;
      margin-bottom: 0.5rem;
    }
    .status-metric {
      display: flex;
      justify-content: space-between;
      font-size: 0.875rem;
      margin-top: 0.5rem;
    }
    .status-error {
      color: #ef4444;
      font-size: 0.875rem;
      margin-top: 0.5rem;
    }
    .last-updated {
      text-align: center;
      color: #6b7280;
      font-size: 0.875rem;
      margin-top: 2rem;
    }
    .refresh-btn {
      background: #3b82f6;
      color: white;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 0.375rem;
      cursor: pointer;
      font-size: 0.875rem;
    }
    .refresh-btn:hover {
      background: #2563eb;
    }
  </style>
  <script>
    setTimeout(() => location.reload(), 30000); // Auto-refresh every 30 seconds
  </script>
</head>
<body>
  <div class="container">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
      <h1>🚀 GraphQL Federation Status</h1>
      <button class="refresh-btn" onclick="location.reload()">Refresh</button>
    </div>
    
    <div class="status-grid">
      <!-- Gateway Status -->
      <div class="status-card">
        <div class="status-header">
          <span class="status-indicator" style="background: ${statusColor(status.gateway.status)}"></span>
          <span class="status-title">Hive Gateway</span>
        </div>
        <div class="status-url">${status.gateway.url}</div>
        <div class="status-metric">
          <span>Status:</span>
          <span style="color: ${statusColor(status.gateway.status)}">${status.gateway.status.toUpperCase()}</span>
        </div>
      </div>
      
      <!-- Subgraph Status -->
      ${status.subgraphs.map(subgraph => `
        <div class="status-card">
          <div class="status-header">
            <span class="status-indicator" style="background: ${statusColor(subgraph.status)}"></span>
            <span class="status-title">${subgraph.name.charAt(0).toUpperCase() + subgraph.name.slice(1)} Subgraph</span>
          </div>
          <div class="status-url">${subgraph.url}</div>
          <div class="status-metric">
            <span>Status:</span>
            <span style="color: ${statusColor(subgraph.status)}">${subgraph.status.toUpperCase()}</span>
          </div>
          ${subgraph.responseTime ? `
            <div class="status-metric">
              <span>Response Time:</span>
              <span>${subgraph.responseTime}ms</span>
            </div>
          ` : ''}
          ${subgraph.error ? `
            <div class="status-error">Error: ${subgraph.error}</div>
          ` : ''}
        </div>
      `).join('')}
    </div>
    
    <div class="last-updated">
      Last updated: ${status.lastUpdated.toLocaleString()}
    </div>
  </div>
</body>
</html>
  `;
}

export async function startStatusServer() {
  const server = createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
      return;
    }
    
    if (req.url === '/api/status') {
      const status = await getFederationStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status, null, 2));
      return;
    }
    
    const status = await getFederationStatus();
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(generateStatusHTML(status));
  });
  
  server.listen(PORT, () => {
    logger.info(`📊 Federation Status Server running at http://localhost:${PORT}`);
  });
}

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startStatusServer().catch(error => {
    logger.error('Failed to start status server', error);
    process.exit(1);
  });
}