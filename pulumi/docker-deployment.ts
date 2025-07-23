import * as pulumi from '@pulumi/pulumi';
import * as docker from '@pulumi/docker';
import { dockerInfraConfig, type DockerServiceConfig } from './docker-infrastructure.js';
import { logger } from '../src/lib/unjs-utils.js';

// Create Docker network
const network = new docker.Network('pothos-todo-network', {
  name: dockerInfraConfig.network.name,
  driver: dockerInfraConfig.network.driver,
  ipamConfig: {
    subnet: dockerInfraConfig.network.subnet,
  },
  labels: {
    'project': 'pothos-todo',
    'environment': dockerInfraConfig.environment,
    'managed-by': 'pulumi',
  },
});

// Create Docker volumes
const volumes = Object.entries(dockerInfraConfig.volumes).reduce((acc, [key, volumeConfig]) => {
  acc[key] = new docker.Volume(`${key}-volume`, {
    name: volumeConfig.name,
    driver: volumeConfig.driver || 'local',
    driverOpts: volumeConfig.driverOpts,
    labels: {
      'project': 'pothos-todo',
      'environment': dockerInfraConfig.environment,
      'managed-by': 'pulumi',
      'volume-type': key,
    },
  });
  return acc;
}, {} as Record<string, docker.Volume>);

// Helper function to create Docker images
function createDockerImage(name: string, serviceConfig: DockerServiceConfig, buildContext?: string) {
  if (buildContext) {
    // Build custom image from local context
    return new docker.Image(`${name}-image`, {
      imageName: `${dockerInfraConfig.dockerRegistry}/${dockerInfraConfig.namespace}/${name}:${serviceConfig.tag}`,
      build: {
        context: buildContext,
        dockerfile: `./docker/${name}/Dockerfile`,
        args: {
          NODE_ENV: dockerInfraConfig.environment,
          BUILD_VERSION: serviceConfig.tag,
        },
        target: dockerInfraConfig.environment === 'production' ? 'production' : 'development',
      },
      skipPush: dockerInfraConfig.environment === 'development',
    });
  } else {
    // Use remote image
    return new docker.RemoteImage(`${name}-image`, {
      name: `${serviceConfig.image}:${serviceConfig.tag}`,
      keepLocally: true,
    });
  }
}

// Helper function to create Docker containers
function createDockerContainer(
  name: string, 
  serviceConfig: DockerServiceConfig, 
  image: docker.Image | docker.RemoteImage,
  dependencies: docker.Container[] = []
) {
  const containerVolumes = serviceConfig.volumes?.map(volume => {
    if (volume.type === 'bind') {
      return `${volume.source}:${volume.target}`;
    } else {
      const volumeResource = volumes[volume.source];
      return pulumi.interpolate`${volumeResource.name}:${volume.target}`;
    }
  }) || [];

  const containerPorts = serviceConfig.ports.map(port => ({
    internal: port.internal,
    external: port.external,
    protocol: port.protocol || 'tcp',
  }));

  const dependsOnContainers = dependencies.map(dep => dep.name);

  return new docker.Container(`${name}-container`, {
    name: `${dockerInfraConfig.namespace}-${name}`,
    image: image.name,
    restart: serviceConfig.restart || 'unless-stopped',
    ports: containerPorts,
    envs: Object.entries(serviceConfig.environment).map(([key, value]) => `${key}=${value}`),
    volumes: containerVolumes,
    networksAdvanced: [{
      name: network.name,
      aliases: [name],
    }],
    healthcheck: serviceConfig.healthcheck ? {
      tests: serviceConfig.healthcheck.test,
      interval: serviceConfig.healthcheck.interval,
      timeout: serviceConfig.healthcheck.timeout,
      retries: serviceConfig.healthcheck.retries,
      startPeriod: serviceConfig.healthcheck.startPeriod,
    } : undefined,
    cpuShares: serviceConfig.resources ? parseInt(parseFloat(serviceConfig.resources.cpus) * 1024 + '') : undefined,
    memory: serviceConfig.resources ? parseMemoryToMB(serviceConfig.resources.memory) : undefined,
    labels: {
      'project': 'pothos-todo',
      'environment': dockerInfraConfig.environment,
      'managed-by': 'pulumi',
      'service': name,
      ...serviceConfig.labels,
    },
    mustRun: true,
  }, { dependsOn: dependencies });
}

// Helper function to parse memory strings to MB
function parseMemoryToMB(memory: string): number {
  const match = memory.match(/^(\d+(?:\.\d+)?)([KMGT]?)$/i);
  if (!match) throw new Error(`Invalid memory format: ${memory}`);
  
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  
  switch (unit) {
    case 'K': return Math.floor(value / 1024);
    case 'M': return Math.floor(value);
    case 'G': return Math.floor(value * 1024);
    case 'T': return Math.floor(value * 1024 * 1024);
    default: return Math.floor(value / (1024 * 1024)); // Assume bytes
  }
}

// Create Docker images for each service
const images = {
  postgres: createDockerImage('postgres', dockerInfraConfig.services.postgres),
  redis: createDockerImage('redis', dockerInfraConfig.services.redis),
  qdrant: createDockerImage('qdrant', dockerInfraConfig.services.qdrant),
  monitoring: createDockerImage('monitoring', dockerInfraConfig.services.monitoring),
  grafana: createDockerImage('grafana', dockerInfraConfig.services.grafana),
  jaeger: createDockerImage('jaeger', dockerInfraConfig.services.jaeger),
  hiveGateway: createDockerImage('hive-gateway', dockerInfraConfig.services.hiveGateway),
  app: dockerInfraConfig.environment === 'development' 
    ? createDockerImage('app', dockerInfraConfig.services.app)
    : createDockerImage('app', dockerInfraConfig.services.app, '.'),
};

// Create Docker containers with proper dependency order
const containers = {
  // Core infrastructure services
  postgres: createDockerContainer('postgres', dockerInfraConfig.services.postgres, images.postgres),
  redis: createDockerContainer('redis', dockerInfraConfig.services.redis, images.redis),
  qdrant: createDockerContainer('qdrant', dockerInfraConfig.services.qdrant, images.qdrant),
  
  // Monitoring services
  jaeger: createDockerContainer('jaeger', dockerInfraConfig.services.jaeger, images.jaeger),
  prometheus: createDockerContainer('monitoring', dockerInfraConfig.services.monitoring, images.monitoring),
};

// Add Grafana with dependency on Prometheus and Jaeger
containers.grafana = createDockerContainer(
  'grafana', 
  dockerInfraConfig.services.grafana, 
  images.grafana,
  [containers.prometheus, containers.jaeger]
);

// Add main application with dependencies on core services
containers.app = createDockerContainer(
  'app',
  dockerInfraConfig.services.app,
  images.app,
  [containers.postgres, containers.redis, containers.qdrant, containers.jaeger]
);

// Add Hive Gateway with dependency on app
containers.hiveGateway = createDockerContainer(
  'hive-gateway',
  dockerInfraConfig.services.hiveGateway,
  images.hiveGateway,
  [containers.app]
);

// Docker Compose file generation for backup/reference
const dockerComposeConfig = {
  version: '3.8',
  networks: {
    [dockerInfraConfig.network.name]: {
      driver: dockerInfraConfig.network.driver,
      ipam: {
        config: [{ subnet: dockerInfraConfig.network.subnet }],
      },
    },
  },
  volumes: Object.entries(dockerInfraConfig.volumes).reduce((acc, [key, config]) => {
    acc[config.name] = {
      driver: config.driver || 'local',
      driver_opts: config.driverOpts,
    };
    return acc;
  }, {} as Record<string, any>),
  services: Object.entries(dockerInfraConfig.services).reduce((acc, [serviceName, serviceConfig]) => {
    acc[serviceName] = {
      image: `${serviceConfig.image}:${serviceConfig.tag}`,
      container_name: `${dockerInfraConfig.namespace}-${serviceName}`,
      restart: serviceConfig.restart || 'unless-stopped',
      ports: serviceConfig.ports.map(p => `${p.external}:${p.internal}`),
      environment: serviceConfig.environment,
      volumes: serviceConfig.volumes?.map(v => 
        v.type === 'bind' ? `${v.source}:${v.target}` : `${v.source}:${v.target}`
      ),
      networks: [dockerInfraConfig.network.name],
      depends_on: serviceConfig.dependsOn,
      healthcheck: serviceConfig.healthcheck ? {
        test: serviceConfig.healthcheck.test,
        interval: serviceConfig.healthcheck.interval,
        timeout: serviceConfig.healthcheck.timeout,
        retries: serviceConfig.healthcheck.retries,
        start_period: serviceConfig.healthcheck.startPeriod,
      } : undefined,
      deploy: serviceConfig.resources ? {
        resources: {
          limits: {
            cpus: serviceConfig.resources.cpus,
            memory: serviceConfig.resources.memory,
          },
        },
      } : undefined,
      labels: {
        'project': 'pothos-todo',
        'environment': dockerInfraConfig.environment,
        'managed-by': 'pulumi',
        ...serviceConfig.labels,
      },
    };
    return acc;
  }, {} as Record<string, any>),
};

// Export resources and outputs
export const networkId = network.id;
export const networkName = network.name;

export const volumeIds = Object.entries(volumes).reduce((acc, [key, volume]) => {
  acc[key] = volume.id;
  return acc;
}, {} as Record<string, pulumi.Output<string>>);

export const containerIds = Object.entries(containers).reduce((acc, [key, container]) => {
  acc[key] = container.id;
  return acc;
}, {} as Record<string, pulumi.Output<string>>);

export const containerNames = Object.entries(containers).reduce((acc, [key, container]) => {
  acc[key] = container.name;
  return acc;
}, {} as Record<string, pulumi.Output<string>>);

// Service URLs for external access
export const serviceUrls = {
  app: pulumi.interpolate`http://localhost:${dockerInfraConfig.services.app.ports[0].external}`,
  hiveGateway: pulumi.interpolate`http://localhost:${dockerInfraConfig.services.hiveGateway.ports[0].external}`,
  grafana: pulumi.interpolate`http://localhost:${dockerInfraConfig.services.grafana.ports[0].external}`,
  prometheus: pulumi.interpolate`http://localhost:${dockerInfraConfig.services.monitoring.ports[0].external}`,
  jaeger: pulumi.interpolate`http://localhost:${dockerInfraConfig.services.jaeger.ports[0].external}`,
};

// Infrastructure status and health
export const infrastructureStatus = {
  environment: dockerInfraConfig.environment,
  namespace: dockerInfraConfig.namespace,
  network: dockerInfraConfig.network.name,
  servicesCount: Object.keys(dockerInfraConfig.services).length,
  volumesCount: Object.keys(dockerInfraConfig.volumes).length,
};

// Export Docker Compose for reference
export const dockerCompose = dockerComposeConfig;

// Export all resources
export {
  network,
  volumes,
  images,
  containers,
  dockerInfraConfig,
};