import * as pulumi from '@pulumi/pulumi';
import * as docker from '@pulumi/docker';
import { logger } from '../src/lib/unjs-utils.js';

// Pulumi configuration
const config = new pulumi.Config();
const stack = pulumi.getStack();
const project = pulumi.getProject();

// Environment configuration
const environment = config.get('environment') || stack;
const dockerRegistry = config.get('dockerRegistry') || 'ghcr.io';
const namespace = config.get('namespace') || 'pothos-todo';

// Docker infrastructure configuration
interface DockerInfrastructureConfig {
  environment: string;
  dockerRegistry: string;
  namespace: string;
  network: {
    name: string;
    driver: string;
    subnet: string;
  };
  services: {
    app: DockerServiceConfig;
    postgres: DockerServiceConfig;
    redis: DockerServiceConfig;
    qdrant: DockerServiceConfig;
    hiveGateway: DockerServiceConfig;
    monitoring: DockerServiceConfig;
    grafana: DockerServiceConfig;
    jaeger: DockerServiceConfig;
  };
  volumes: {
    postgres: VolumeConfig;
    redis: VolumeConfig;
    qdrant: VolumeConfig;
    prometheus: VolumeConfig;
    grafana: VolumeConfig;
  };
}

interface DockerServiceConfig {
  image: string;
  tag: string;
  ports: Array<{ internal: number; external: number; protocol?: string }>;
  environment: Record<string, string>;
  volumes?: Array<{ source: string; target: string; type?: string }>;
  dependsOn?: string[];
  restart?: string;
  healthcheck?: {
    test: string[];
    interval: string;
    timeout: string;
    retries: number;
    startPeriod: string;
  };
  resources?: {
    cpus: string;
    memory: string;
  };
  labels?: Record<string, string>;
}

interface VolumeConfig {
  name: string;
  driver?: string;
  driverOpts?: Record<string, string>;
}

// Environment-specific Docker configurations
const dockerConfigs: Record<string, DockerInfrastructureConfig> = {
  development: {
    environment: 'development',
    dockerRegistry,
    namespace: `${namespace}-dev`,
    network: {
      name: 'pothos-todo-dev',
      driver: 'bridge',
      subnet: '172.20.0.0/16',
    },
    services: {
      app: {
        image: 'node',
        tag: '20-alpine',
        ports: [{ internal: 4000, external: 4000 }],
        environment: {
          NODE_ENV: 'development',
          LOG_LEVEL: 'debug',
          DATABASE_URL: 'postgresql://postgres:password@postgres:5432/pothos_todo',
          REDIS_URL: 'redis://redis:6379',
          QDRANT_URL: 'http://qdrant:6333',
          GATEWAY_URL: 'http://hive-gateway:4000',
          PROMETHEUS_URL: 'http://prometheus:9090',
        },
        volumes: [
          { source: './src', target: '/app/src', type: 'bind' },
          { source: './package.json', target: '/app/package.json', type: 'bind' },
          { source: './bun.lockb', target: '/app/bun.lockb', type: 'bind' },
        ],
        dependsOn: ['postgres', 'redis', 'qdrant'],
        restart: 'unless-stopped',
        healthcheck: {
          test: ['CMD', 'curl', '-f', 'http://localhost:4000/health'],
          interval: '30s',
          timeout: '10s',
          retries: 3,
          startPeriod: '40s',
        },
        resources: {
          cpus: '0.5',
          memory: '512M',
        },
        labels: {
          'traefik.enable': 'true',
          'traefik.http.routers.app.rule': 'Host(`localhost`)',
          'traefik.http.services.app.loadbalancer.server.port': '4000',
        },
      },
      postgres: {
        image: 'postgres',
        tag: '16-alpine',
        ports: [{ internal: 5432, external: 5432 }],
        environment: {
          POSTGRES_DB: 'pothos_todo',
          POSTGRES_USER: 'postgres',
          POSTGRES_PASSWORD: 'password',
          POSTGRES_INITDB_ARGS: '--encoding=UTF-8 --lc-collate=C --lc-ctype=C',
        },
        volumes: [
          { source: 'postgres_data', target: '/var/lib/postgresql/data' },
          { source: './scripts/db', target: '/docker-entrypoint-initdb.d', type: 'bind' },
        ],
        restart: 'unless-stopped',
        healthcheck: {
          test: ['CMD-SHELL', 'pg_isready -U postgres'],
          interval: '10s',
          timeout: '5s',
          retries: 5,
          startPeriod: '30s',
        },
        resources: {
          cpus: '0.5',
          memory: '1G',
        },
        labels: {
          'backup.enable': 'true',
          'backup.schedule': '0 2 * * *',
        },
      },
      redis: {
        image: 'redis',
        tag: '7-alpine',
        ports: [{ internal: 6379, external: 6379 }],
        environment: {
          REDIS_PASSWORD: 'redis_password',
        },
        volumes: [
          { source: 'redis_data', target: '/data' },
          { source: './config/redis.conf', target: '/usr/local/etc/redis/redis.conf', type: 'bind' },
        ],
        restart: 'unless-stopped',
        healthcheck: {
          test: ['CMD', 'redis-cli', '--raw', 'incr', 'ping'],
          interval: '10s',
          timeout: '3s',
          retries: 5,
          startPeriod: '20s',
        },
        resources: {
          cpus: '0.25',
          memory: '256M',
        },
        labels: {
          'monitoring.enable': 'true',
        },
      },
      qdrant: {
        image: 'qdrant/qdrant',
        tag: 'latest',
        ports: [{ internal: 6333, external: 6333 }],
        environment: {
          QDRANT__SERVICE__HTTP_PORT: '6333',
          QDRANT__SERVICE__GRPC_PORT: '6334',
        },
        volumes: [
          { source: 'qdrant_data', target: '/qdrant/storage' },
        ],
        restart: 'unless-stopped',
        healthcheck: {
          test: ['CMD', 'curl', '-f', 'http://localhost:6333/health'],
          interval: '15s',
          timeout: '5s',
          retries: 3,
          startPeriod: '30s',
        },
        resources: {
          cpus: '0.5',
          memory: '1G',
        },
        labels: {
          'ai.enable': 'true',
          'vector-db.type': 'qdrant',
        },
      },
      hiveGateway: {
        image: 'ghcr.io/graphql-hive/gateway',
        tag: 'latest',
        ports: [{ internal: 4000, external: 4001 }],
        environment: {
          HIVE_CDN_ENDPOINT: config.get('hiveCdnEndpoint') || '',
          HIVE_CDN_KEY: config.get('hiveCdnKey') || '',
          USER_SUBGRAPH_URL: 'http://app:4001/graphql',
          TODO_SUBGRAPH_URL: 'http://app:4002/graphql',
          AI_SUBGRAPH_URL: 'http://app:4003/graphql',
          PROMETHEUS_METRICS: 'true',
          LOG_LEVEL: 'debug',
        },
        dependsOn: ['app'],
        restart: 'unless-stopped',
        healthcheck: {
          test: ['CMD', 'curl', '-f', 'http://localhost:4000/health'],
          interval: '30s',
          timeout: '10s',
          retries: 3,
          startPeriod: '60s',
        },
        resources: {
          cpus: '0.5',
          memory: '512M',
        },
        labels: {
          'traefik.enable': 'true',
          'traefik.http.routers.gateway.rule': 'Host(`gateway.localhost`)',
          'traefik.http.services.gateway.loadbalancer.server.port': '4000',
          'federation.gateway': 'true',
        },
      },
      monitoring: {
        image: 'prom/prometheus',
        tag: 'latest',
        ports: [{ internal: 9090, external: 9090 }],
        environment: {
          PROMETHEUS_RETENTION_TIME: '15d',
          PROMETHEUS_RETENTION_SIZE: '10GB',
        },
        volumes: [
          { source: 'prometheus_data', target: '/prometheus' },
          { source: './config/prometheus.yml', target: '/etc/prometheus/prometheus.yml', type: 'bind' },
        ],
        restart: 'unless-stopped',
        healthcheck: {
          test: ['CMD', 'wget', '--no-verbose', '--tries=1', '--spider', 'http://localhost:9090/-/healthy'],
          interval: '15s',
          timeout: '10s',
          retries: 3,
          startPeriod: '30s',
        },
        resources: {
          cpus: '0.5',
          memory: '1G',
        },
        labels: {
          'monitoring.type': 'prometheus',
          'traefik.enable': 'true',
          'traefik.http.routers.prometheus.rule': 'Host(`prometheus.localhost`)',
        },
      },
      grafana: {
        image: 'grafana/grafana',
        tag: 'latest',
        ports: [{ internal: 3000, external: 3000 }],
        environment: {
          GF_SECURITY_ADMIN_PASSWORD: 'admin',
          GF_INSTALL_PLUGINS: 'grafana-clock-panel,grafana-simple-json-datasource,redis-datasource',
          GF_PROMETHEUS_URL: 'http://prometheus:9090',
        },
        volumes: [
          { source: 'grafana_data', target: '/var/lib/grafana' },
          { source: './config/grafana', target: '/etc/grafana/provisioning', type: 'bind' },
        ],
        dependsOn: ['monitoring'],
        restart: 'unless-stopped',
        healthcheck: {
          test: ['CMD', 'curl', '-f', 'http://localhost:3000/api/health'],
          interval: '30s',
          timeout: '10s',
          retries: 3,
          startPeriod: '60s',
        },
        resources: {
          cpus: '0.25',
          memory: '512M',
        },
        labels: {
          'monitoring.type': 'grafana',
          'traefik.enable': 'true',
          'traefik.http.routers.grafana.rule': 'Host(`grafana.localhost`)',
        },
      },
      jaeger: {
        image: 'jaegertracing/all-in-one',
        tag: 'latest',
        ports: [
          { internal: 16686, external: 16686 }, // UI
          { internal: 14268, external: 14268 }, // HTTP collector
          { internal: 14250, external: 14250 }, // gRPC collector
        ],
        environment: {
          COLLECTOR_ZIPKIN_HOST_PORT: ':9411',
          COLLECTOR_OTLP_ENABLED: 'true',
        },
        restart: 'unless-stopped',
        healthcheck: {
          test: ['CMD', 'wget', '--no-verbose', '--tries=1', '--spider', 'http://localhost:16686/'],
          interval: '30s',
          timeout: '10s',
          retries: 3,
          startPeriod: '30s',
        },
        resources: {
          cpus: '0.25',
          memory: '512M',
        },
        labels: {
          'tracing.type': 'jaeger',
          'traefik.enable': 'true',
          'traefik.http.routers.jaeger.rule': 'Host(`jaeger.localhost`)',
          'traefik.http.services.jaeger.loadbalancer.server.port': '16686',
        },
      },
    },
    volumes: {
      postgres: {
        name: 'postgres_data',
        driver: 'local',
      },
      redis: {
        name: 'redis_data',
        driver: 'local',
      },
      qdrant: {
        name: 'qdrant_data',
        driver: 'local',
      },
      prometheus: {
        name: 'prometheus_data',
        driver: 'local',
      },
      grafana: {
        name: 'grafana_data',
        driver: 'local',
      },
    },
  },
  production: {
    environment: 'production',
    dockerRegistry,
    namespace: `${namespace}-prod`,
    network: {
      name: 'pothos-todo-prod',
      driver: 'bridge',
      subnet: '172.21.0.0/16',
    },
    services: {
      app: {
        image: `${dockerRegistry}/${namespace}/app`,
        tag: 'latest',
        ports: [{ internal: 4000, external: 4000 }],
        environment: {
          NODE_ENV: 'production',
          LOG_LEVEL: 'info',
          DATABASE_URL: 'postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/pothos_todo',
          REDIS_URL: 'redis://:${REDIS_PASSWORD}@redis:6379',
          QDRANT_URL: 'http://qdrant:6333',
          GATEWAY_URL: 'http://hive-gateway:4000',
          PROMETHEUS_URL: 'http://prometheus:9090',
          JAEGER_ENDPOINT: 'http://jaeger:14268/api/traces',
        },
        dependsOn: ['postgres', 'redis', 'qdrant'],
        restart: 'unless-stopped',
        healthcheck: {
          test: ['CMD', 'curl', '-f', 'http://localhost:4000/health'],
          interval: '30s',
          timeout: '10s',
          retries: 5,
          startPeriod: '60s',
        },
        resources: {
          cpus: '2.0',
          memory: '4G',
        },
        labels: {
          'traefik.enable': 'true',
          'traefik.http.routers.app-secure.rule': 'Host(`api.pothos-todo.com`)',
          'traefik.http.routers.app-secure.tls': 'true',
          'traefik.http.routers.app-secure.tls.certresolver': 'letsencrypt',
        },
      },
      postgres: {
        image: 'postgres',
        tag: '16-alpine',
        ports: [{ internal: 5432, external: 5432 }],
        environment: {
          POSTGRES_DB: 'pothos_todo',
          POSTGRES_USER: 'postgres',
          POSTGRES_PASSWORD: '${POSTGRES_PASSWORD}',
          POSTGRES_INITDB_ARGS: '--encoding=UTF-8 --lc-collate=C --lc-ctype=C',
        },
        volumes: [
          { source: 'postgres_data', target: '/var/lib/postgresql/data' },
          { source: './scripts/db', target: '/docker-entrypoint-initdb.d', type: 'bind' },
        ],
        restart: 'unless-stopped',
        healthcheck: {
          test: ['CMD-SHELL', 'pg_isready -U postgres'],
          interval: '10s',
          timeout: '5s',
          retries: 5,
          startPeriod: '30s',
        },
        resources: {
          cpus: '4.0',
          memory: '8G',
        },
        labels: {
          'backup.enable': 'true',
          'backup.schedule': '0 2 * * *',
          'backup.retention': '30d',
        },
      },
      redis: {
        image: 'redis',
        tag: '7-alpine',
        ports: [{ internal: 6379, external: 6379 }],
        environment: {
          REDIS_PASSWORD: '${REDIS_PASSWORD}',
        },
        volumes: [
          { source: 'redis_data', target: '/data' },
          { source: './config/redis-prod.conf', target: '/usr/local/etc/redis/redis.conf', type: 'bind' },
        ],
        restart: 'unless-stopped',
        healthcheck: {
          test: ['CMD', 'redis-cli', '--raw', 'incr', 'ping'],
          interval: '10s',
          timeout: '3s',
          retries: 5,
          startPeriod: '20s',
        },
        resources: {
          cpus: '1.0',
          memory: '2G',
        },
        labels: {
          'monitoring.enable': 'true',
          'cluster.type': 'redis',
        },
      },
      qdrant: {
        image: 'qdrant/qdrant',
        tag: 'latest',
        ports: [{ internal: 6333, external: 6333 }],
        environment: {
          QDRANT__SERVICE__HTTP_PORT: '6333',
          QDRANT__SERVICE__GRPC_PORT: '6334',
          QDRANT__CLUSTER__ENABLED: 'true',
        },
        volumes: [
          { source: 'qdrant_data', target: '/qdrant/storage' },
        ],
        restart: 'unless-stopped',
        healthcheck: {
          test: ['CMD', 'curl', '-f', 'http://localhost:6333/health'],
          interval: '15s',
          timeout: '5s',
          retries: 3,
          startPeriod: '30s',
        },
        resources: {
          cpus: '2.0',
          memory: '8G',
        },
        labels: {
          'ai.enable': 'true',
          'vector-db.type': 'qdrant',
          'cluster.enabled': 'true',
        },
      },
      hiveGateway: {
        image: 'ghcr.io/graphql-hive/gateway',
        tag: 'latest',
        ports: [{ internal: 4000, external: 4001 }],
        environment: {
          HIVE_CDN_ENDPOINT: '${HIVE_CDN_ENDPOINT}',
          HIVE_CDN_KEY: '${HIVE_CDN_KEY}',
          USER_SUBGRAPH_URL: 'http://app:4001/graphql',
          TODO_SUBGRAPH_URL: 'http://app:4002/graphql',
          AI_SUBGRAPH_URL: 'http://app:4003/graphql',
          PROMETHEUS_METRICS: 'true',
          LOG_LEVEL: 'info',
          JAEGER_ENDPOINT: 'http://jaeger:14268/api/traces',
        },
        dependsOn: ['app'],
        restart: 'unless-stopped',
        healthcheck: {
          test: ['CMD', 'curl', '-f', 'http://localhost:4000/health'],
          interval: '30s',
          timeout: '10s',
          retries: 5,
          startPeriod: '120s',
        },
        resources: {
          cpus: '2.0',
          memory: '4G',
        },
        labels: {
          'traefik.enable': 'true',
          'traefik.http.routers.gateway-secure.rule': 'Host(`gateway.pothos-todo.com`)',
          'traefik.http.routers.gateway-secure.tls': 'true',
          'traefik.http.routers.gateway-secure.tls.certresolver': 'letsencrypt',
          'federation.gateway': 'true',
        },
      },
      monitoring: {
        image: 'prom/prometheus',
        tag: 'latest',
        ports: [{ internal: 9090, external: 9090 }],
        environment: {
          PROMETHEUS_RETENTION_TIME: '90d',
          PROMETHEUS_RETENTION_SIZE: '100GB',
        },
        volumes: [
          { source: 'prometheus_data', target: '/prometheus' },
          { source: './config/prometheus-prod.yml', target: '/etc/prometheus/prometheus.yml', type: 'bind' },
        ],
        restart: 'unless-stopped',
        healthcheck: {
          test: ['CMD', 'wget', '--no-verbose', '--tries=1', '--spider', 'http://localhost:9090/-/healthy'],
          interval: '15s',
          timeout: '10s',
          retries: 3,
          startPeriod: '30s',
        },
        resources: {
          cpus: '2.0',
          memory: '4G',
        },
        labels: {
          'monitoring.type': 'prometheus',
          'traefik.enable': 'true',
          'traefik.http.routers.prometheus-secure.rule': 'Host(`metrics.pothos-todo.com`)',
          'traefik.http.routers.prometheus-secure.tls': 'true',
        },
      },
      grafana: {
        image: 'grafana/grafana',
        tag: 'latest',
        ports: [{ internal: 3000, external: 3000 }],
        environment: {
          GF_SECURITY_ADMIN_PASSWORD: '${GRAFANA_PASSWORD}',
          GF_INSTALL_PLUGINS: 'grafana-clock-panel,grafana-simple-json-datasource,redis-datasource,jaeger-datasource',
          GF_PROMETHEUS_URL: 'http://prometheus:9090',
          GF_JAEGER_URL: 'http://jaeger:16686',
        },
        volumes: [
          { source: 'grafana_data', target: '/var/lib/grafana' },
          { source: './config/grafana-prod', target: '/etc/grafana/provisioning', type: 'bind' },
        ],
        dependsOn: ['monitoring', 'jaeger'],
        restart: 'unless-stopped',
        healthcheck: {
          test: ['CMD', 'curl', '-f', 'http://localhost:3000/api/health'],
          interval: '30s',
          timeout: '10s',
          retries: 3,
          startPeriod: '60s',
        },
        resources: {
          cpus: '1.0',
          memory: '2G',
        },
        labels: {
          'monitoring.type': 'grafana',
          'traefik.enable': 'true',
          'traefik.http.routers.grafana-secure.rule': 'Host(`monitoring.pothos-todo.com`)',
          'traefik.http.routers.grafana-secure.tls': 'true',
        },
      },
      jaeger: {
        image: 'jaegertracing/all-in-one',
        tag: 'latest',
        ports: [
          { internal: 16686, external: 16686 },
          { internal: 14268, external: 14268 },
          { internal: 14250, external: 14250 },
        ],
        environment: {
          COLLECTOR_ZIPKIN_HOST_PORT: ':9411',
          COLLECTOR_OTLP_ENABLED: 'true',
          SPAN_STORAGE_TYPE: 'badger',
          BADGER_EPHEMERAL: 'false',
          BADGER_DIRECTORY_VALUE: '/badger/data',
          BADGER_DIRECTORY_KEY: '/badger/key',
        },
        volumes: [
          { source: 'jaeger_data', target: '/badger' },
        ],
        restart: 'unless-stopped',
        healthcheck: {
          test: ['CMD', 'wget', '--no-verbose', '--tries=1', '--spider', 'http://localhost:16686/'],
          interval: '30s',
          timeout: '10s',
          retries: 3,
          startPeriod: '30s',
        },
        resources: {
          cpus: '1.0',
          memory: '2G',
        },
        labels: {
          'tracing.type': 'jaeger',
          'traefik.enable': 'true',
          'traefik.http.routers.jaeger-secure.rule': 'Host(`tracing.pothos-todo.com`)',
          'traefik.http.routers.jaeger-secure.tls': 'true',
        },
      },
    },
    volumes: {
      postgres: {
        name: 'postgres_data',
        driver: 'local',
        driverOpts: {
          type: 'none',
          o: 'bind',
          device: '/var/lib/docker/volumes/postgres_data',
        },
      },
      redis: {
        name: 'redis_data',
        driver: 'local',
      },
      qdrant: {
        name: 'qdrant_data',
        driver: 'local',
      },
      prometheus: {
        name: 'prometheus_data',
        driver: 'local',
      },
      grafana: {
        name: 'grafana_data',
        driver: 'local',
      },
    },
  },
};

// Get current environment configuration
export const dockerInfraConfig = dockerConfigs[environment] || dockerConfigs.development;

// Export configuration and types
export type { DockerInfrastructureConfig, DockerServiceConfig, VolumeConfig };
export default dockerInfraConfig;