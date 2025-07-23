import * as pulumi from '@pulumi/pulumi';
import * as docker from '@pulumi/docker';
import * as kubernetes from '@pulumi/kubernetes';
import { logger } from '../src/lib/unjs-utils.js';

// Pulumi configuration
const config = new pulumi.Config();
const stack = pulumi.getStack();
const project = pulumi.getProject();

// Environment configuration
const environment = config.get('environment') || stack;
const region = config.get('region') || 'us-west-2';
const dockerRegistry = config.get('dockerRegistry') || 'ghcr.io';
const namespace = config.get('namespace') || 'pothos-todo';

// Infrastructure configuration
interface InfrastructureConfig {
  environment: string;
  region: string;
  dockerRegistry: string;
  namespace: string;
  services: {
    app: ServiceConfig;
    postgres: ServiceConfig;
    redis: ServiceConfig;
    qdrant: ServiceConfig;
    hiveGateway: ServiceConfig;
    monitoring: ServiceConfig;
  };
  scaling: {
    minReplicas: number;
    maxReplicas: number;
    targetCPUUtilization: number;
    targetMemoryUtilization: number;
  };
  networking: {
    enableIngress: boolean;
    enableTLS: boolean;
    domain?: string;
  };
  storage: {
    postgres: StorageConfig;
    redis: StorageConfig;
    monitoring: StorageConfig;
  };
}

interface ServiceConfig {
  image: string;
  tag: string;
  port: number;
  replicas: number;
  resources: {
    requests: { cpu: string; memory: string };
    limits: { cpu: string; memory: string };
  };
  env?: Record<string, string>;
  healthCheck?: {
    path: string;
    initialDelaySeconds: number;
    periodSeconds: number;
  };
}

interface StorageConfig {
  size: string;
  storageClass?: string;
  backup?: {
    enabled: boolean;
    schedule: string;
    retention: string;
  };
}

// Environment-specific configurations
const configs: Record<string, InfrastructureConfig> = {
  development: {
    environment: 'development',
    region,
    dockerRegistry,
    namespace: `${namespace}-dev`,
    services: {
      app: {
        image: `${dockerRegistry}/${namespace}/app`,
        tag: 'dev',
        port: 4000,
        replicas: 1,
        resources: {
          requests: { cpu: '100m', memory: '256Mi' },
          limits: { cpu: '500m', memory: '512Mi' },
        },
        env: {
          NODE_ENV: 'development',
          LOG_LEVEL: 'debug',
        },
        healthCheck: {
          path: '/health',
          initialDelaySeconds: 30,
          periodSeconds: 10,
        },
      },
      postgres: {
        image: 'postgres',
        tag: '16-alpine',
        port: 5432,
        replicas: 1,
        resources: {
          requests: { cpu: '100m', memory: '256Mi' },
          limits: { cpu: '500m', memory: '1Gi' },
        },
        env: {
          POSTGRES_DB: 'pothos_todo',
          POSTGRES_USER: 'postgres',
          POSTGRES_PASSWORD: 'password',
        },
      },
      redis: {
        image: 'redis',
        tag: '7-alpine',
        port: 6379,
        replicas: 1,
        resources: {
          requests: { cpu: '50m', memory: '128Mi' },
          limits: { cpu: '200m', memory: '256Mi' },
        },
      },
      qdrant: {
        image: 'qdrant/qdrant',
        tag: 'latest',
        port: 6333,
        replicas: 1,
        resources: {
          requests: { cpu: '100m', memory: '512Mi' },
          limits: { cpu: '500m', memory: '1Gi' },
        },
      },
      hiveGateway: {
        image: 'ghcr.io/graphql-hive/gateway',
        tag: 'latest',
        port: 4000,
        replicas: 1,
        resources: {
          requests: { cpu: '100m', memory: '256Mi' },
          limits: { cpu: '500m', memory: '512Mi' },
        },
        healthCheck: {
          path: '/health',
          initialDelaySeconds: 30,
          periodSeconds: 10,
        },
      },
      monitoring: {
        image: 'prom/prometheus',
        tag: 'latest',
        port: 9090,
        replicas: 1,
        resources: {
          requests: { cpu: '100m', memory: '256Mi' },
          limits: { cpu: '500m', memory: '1Gi' },
        },
      },
    },
    scaling: {
      minReplicas: 1,
      maxReplicas: 3,
      targetCPUUtilization: 70,
      targetMemoryUtilization: 80,
    },
    networking: {
      enableIngress: false,
      enableTLS: false,
    },
    storage: {
      postgres: {
        size: '10Gi',
        backup: {
          enabled: false,
          schedule: '0 2 * * *',
          retention: '7d',
        },
      },
      redis: {
        size: '5Gi',
      },
      monitoring: {
        size: '20Gi',
      },
    },
  },
  production: {
    environment: 'production',
    region,
    dockerRegistry,
    namespace: `${namespace}-prod`,
    services: {
      app: {
        image: `${dockerRegistry}/${namespace}/app`,
        tag: 'latest',
        port: 4000,
        replicas: 3,
        resources: {
          requests: { cpu: '500m', memory: '1Gi' },
          limits: { cpu: '2000m', memory: '4Gi' },
        },
        env: {
          NODE_ENV: 'production',
          LOG_LEVEL: 'info',
        },
        healthCheck: {
          path: '/health',
          initialDelaySeconds: 60,
          periodSeconds: 30,
        },
      },
      postgres: {
        image: 'postgres',
        tag: '16-alpine',
        port: 5432,
        replicas: 1,
        resources: {
          requests: { cpu: '1000m', memory: '2Gi' },
          limits: { cpu: '4000m', memory: '8Gi' },
        },
        env: {
          POSTGRES_DB: 'pothos_todo',
          POSTGRES_USER: 'postgres',
        },
      },
      redis: {
        image: 'redis',
        tag: '7-alpine',
        port: 6379,
        replicas: 3,
        resources: {
          requests: { cpu: '200m', memory: '512Mi' },
          limits: { cpu: '1000m', memory: '2Gi' },
        },
      },
      qdrant: {
        image: 'qdrant/qdrant',
        tag: 'latest',
        port: 6333,
        replicas: 2,
        resources: {
          requests: { cpu: '500m', memory: '2Gi' },
          limits: { cpu: '2000m', memory: '8Gi' },
        },
      },
      hiveGateway: {
        image: 'ghcr.io/graphql-hive/gateway',
        tag: 'latest',
        port: 4000,
        replicas: 2,
        resources: {
          requests: { cpu: '500m', memory: '1Gi' },
          limits: { cpu: '2000m', memory: '4Gi' },
        },
        healthCheck: {
          path: '/health',
          initialDelaySeconds: 60,
          periodSeconds: 30,
        },
      },
      monitoring: {
        image: 'prom/prometheus',
        tag: 'latest',
        port: 9090,
        replicas: 1,
        resources: {
          requests: { cpu: '500m', memory: '1Gi' },
          limits: { cpu: '2000m', memory: '4Gi' },
        },
      },
    },
    scaling: {
      minReplicas: 2,
      maxReplicas: 10,
      targetCPUUtilization: 60,
      targetMemoryUtilization: 70,
    },
    networking: {
      enableIngress: true,
      enableTLS: true,
      domain: 'api.pothos-todo.com',
    },
    storage: {
      postgres: {
        size: '100Gi',
        storageClass: 'fast-ssd',
        backup: {
          enabled: true,
          schedule: '0 2 * * *',
          retention: '30d',
        },
      },
      redis: {
        size: '50Gi',
        storageClass: 'fast-ssd',
      },
      monitoring: {
        size: '200Gi',
        storageClass: 'standard',
      },
    },
  },
};

// Get current environment configuration
const infraConfig = configs[environment] || configs.development;

export { infraConfig };
export default infraConfig;