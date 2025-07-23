import { createServer } from 'http';
import { logger } from '../lib/unjs-utils.js';
import chalk from 'chalk';
import { getDashboardData, federationMetrics } from './monitoring.js';

const DASHBOARD_PORT = parseInt(process.env.DASHBOARD_PORT || '4444');

// HTML template for monitoring dashboard
const dashboardHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Federation Monitoring Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #e0e0e0;
      line-height: 1.6;
    }
    
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px;
    }
    
    header {
      background: #1a1a1a;
      padding: 20px 0;
      margin-bottom: 30px;
      border-bottom: 2px solid #333;
    }
    
    h1 {
      font-size: 28px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .status-indicator {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      display: inline-block;
    }
    
    .status-healthy { background: #10b981; }
    .status-degraded { background: #f59e0b; }
    .status-unhealthy { background: #ef4444; }
    
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    
    .metric-card {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 20px;
      transition: transform 0.2s;
    }
    
    .metric-card:hover {
      transform: translateY(-2px);
      border-color: #555;
    }
    
    .metric-label {
      font-size: 14px;
      color: #999;
      margin-bottom: 5px;
    }
    
    .metric-value {
      font-size: 32px;
      font-weight: 600;
      color: #fff;
    }
    
    .metric-unit {
      font-size: 16px;
      color: #666;
      margin-left: 5px;
    }
    
    .metric-change {
      font-size: 14px;
      margin-top: 5px;
    }
    
    .metric-change.positive { color: #10b981; }
    .metric-change.negative { color: #ef4444; }
    
    .charts-section {
      margin-bottom: 30px;
    }
    
    .chart-container {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
      height: 400px;
      position: relative;
    }
    
    .subgraph-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    
    .subgraph-card {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 20px;
    }
    
    .subgraph-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
    }
    
    .subgraph-name {
      font-size: 18px;
      font-weight: 600;
    }
    
    .subgraph-stats {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }
    
    .stat-item {
      display: flex;
      justify-content: space-between;
      font-size: 14px;
    }
    
    .stat-label {
      color: #999;
    }
    
    .stat-value {
      color: #fff;
      font-weight: 500;
    }
    
    .error-log {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 20px;
      max-height: 400px;
      overflow-y: auto;
    }
    
    .error-item {
      padding: 10px;
      border-bottom: 1px solid #333;
      font-size: 14px;
    }
    
    .error-item:last-child {
      border-bottom: none;
    }
    
    .error-timestamp {
      color: #666;
      font-size: 12px;
    }
    
    .error-message {
      color: #ef4444;
      margin-top: 5px;
    }
    
    .refresh-info {
      text-align: center;
      color: #666;
      font-size: 14px;
      margin-top: 20px;
    }
    
    @media (max-width: 768px) {
      .metrics-grid {
        grid-template-columns: 1fr;
      }
      
      .subgraph-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <header>
    <div class="container">
      <h1>
        <span class="status-indicator status-healthy" id="overall-status"></span>
        GraphQL Federation Monitoring
      </h1>
    </div>
  </header>
  
  <div class="container">
    <!-- Key Metrics -->
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-label">Total Requests</div>
        <div class="metric-value">
          <span id="total-requests">0</span>
          <span class="metric-unit">req</span>
        </div>
        <div class="metric-change positive">↑ +12.3%</div>
      </div>
      
      <div class="metric-card">
        <div class="metric-label">Average Latency</div>
        <div class="metric-value">
          <span id="avg-latency">0</span>
          <span class="metric-unit">ms</span>
        </div>
        <div class="metric-change positive">↓ -5.2%</div>
      </div>
      
      <div class="metric-card">
        <div class="metric-label">Error Rate</div>
        <div class="metric-value">
          <span id="error-rate">0</span>
          <span class="metric-unit">%</span>
        </div>
        <div class="metric-change negative">↑ +0.1%</div>
      </div>
      
      <div class="metric-card">
        <div class="metric-label">Active Subscriptions</div>
        <div class="metric-value">
          <span id="active-subs">0</span>
        </div>
        <div class="metric-change positive">↑ +8</div>
      </div>
    </div>
    
    <!-- Charts -->
    <div class="charts-section">
      <div class="chart-container">
        <canvas id="latency-chart"></canvas>
      </div>
      
      <div class="chart-container">
        <canvas id="requests-chart"></canvas>
      </div>
    </div>
    
    <!-- Subgraph Status -->
    <h2 style="margin-bottom: 20px;">Subgraph Status</h2>
    <div class="subgraph-grid" id="subgraph-grid">
      <!-- Subgraph cards will be inserted here -->
    </div>
    
    <!-- Recent Errors -->
    <h2 style="margin-bottom: 20px;">Recent Errors</h2>
    <div class="error-log" id="error-log">
      <!-- Error items will be inserted here -->
    </div>
    
    <div class="refresh-info">
      Auto-refreshing every 5 seconds | Last updated: <span id="last-updated"></span>
    </div>
  </div>
  
  <script>
    // Chart configurations
    const chartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: '#e0e0e0'
          }
        }
      },
      scales: {
        x: {
          grid: {
            color: '#333'
          },
          ticks: {
            color: '#999'
          }
        },
        y: {
          grid: {
            color: '#333'
          },
          ticks: {
            color: '#999'
          }
        }
      }
    };
    
    // Initialize latency chart
    const latencyCtx = document.getElementById('latency-chart').getContext('2d');
    const latencyChart = new Chart(latencyCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Average Latency (ms)',
          data: [],
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          tension: 0.4
        }, {
          label: 'P95 Latency (ms)',
          data: [],
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          tension: 0.4
        }]
      },
      options: chartOptions
    });
    
    // Initialize requests chart
    const requestsCtx = document.getElementById('requests-chart').getContext('2d');
    const requestsChart = new Chart(requestsCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Requests/sec',
          data: [],
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          tension: 0.4
        }, {
          label: 'Errors/sec',
          data: [],
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          tension: 0.4
        }]
      },
      options: chartOptions
    });
    
    // Update dashboard data
    async function updateDashboard() {
      try {
        const response = await fetch('/api/dashboard');
        const data = await response.json();
        
        // Update metrics
        document.getElementById('total-requests').textContent = 
          new Intl.NumberFormat().format(data.overview.totalRequests);
        document.getElementById('avg-latency').textContent = 
          data.overview.averageLatency.toFixed(1);
        document.getElementById('error-rate').textContent = 
          (data.overview.errorRate * 100).toFixed(2);
        document.getElementById('active-subs').textContent = 
          data.overview.activeSubscriptions;
        
        // Update charts
        const labels = data.performanceTrends.timestamps.slice(-30);
        latencyChart.data.labels = labels;
        latencyChart.data.datasets[0].data = data.performanceTrends.latencies.slice(-30);
        latencyChart.update();
        
        requestsChart.data.labels = labels;
        requestsChart.data.datasets[0].data = data.performanceTrends.requestCounts.slice(-30);
        requestsChart.data.datasets[1].data = data.performanceTrends.errorCounts.slice(-30);
        requestsChart.update();
        
        // Update subgraphs
        const subgraphGrid = document.getElementById('subgraph-grid');
        subgraphGrid.innerHTML = data.subgraphs.map(subgraph => \`
          <div class="subgraph-card">
            <div class="subgraph-header">
              <span class="subgraph-name">\${subgraph.name}</span>
              <span class="status-indicator status-\${subgraph.status}"></span>
            </div>
            <div class="subgraph-stats">
              <div class="stat-item">
                <span class="stat-label">Requests</span>
                <span class="stat-value">\${subgraph.requests}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Errors</span>
                <span class="stat-value">\${subgraph.errors}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Latency</span>
                <span class="stat-value">\${subgraph.latency.toFixed(1)}ms</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Status</span>
                <span class="stat-value">\${subgraph.status}</span>
              </div>
            </div>
          </div>
        \`).join('');
        
        // Update errors
        const errorLog = document.getElementById('error-log');
        if (data.recentErrors.length === 0) {
          errorLog.innerHTML = '<div style="text-align: center; color: #666;">No recent errors</div>';
        } else {
          errorLog.innerHTML = data.recentErrors.map(error => \`
            <div class="error-item">
              <div class="error-timestamp">\${error.timestamp} - \${error.subgraph}</div>
              <div class="error-message">\${error.error}</div>
              <div style="color: #666; font-size: 12px;">Operation: \${error.operation}</div>
            </div>
          \`).join('');
        }
        
        // Update last updated time
        document.getElementById('last-updated').textContent = new Date().toLocaleTimeString();
      } catch (error) {
        console.error('Failed to update dashboard:', error);
      }
    }
    
    // Initial update and set interval
    updateDashboard();
    setInterval(updateDashboard, 5000);
  </script>
</body>
</html>
`;

// Start monitoring dashboard server
export function startMonitoringDashboard() {
  const server = createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end(dashboardHTML);
    } else if (req.url === '/api/dashboard') {
      res.setHeader('Content-Type', 'application/json');
      const data = await getDashboardData();
      res.end(JSON.stringify(data));
    } else if (req.url === '/health') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok', service: 'monitoring-dashboard' }));
    } else {
      res.statusCode = 404;
      res.end('Not found');
    }
  });

  server.listen(DASHBOARD_PORT, () => {
    logger.info(chalk.green(`📊 Monitoring dashboard available at http://localhost:${DASHBOARD_PORT}`));
  });

  return server;
}

// Start dashboard if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startMonitoringDashboard();
}