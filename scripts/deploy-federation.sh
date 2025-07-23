#!/bin/bash

# Federation Deployment Script
# This script handles the complete deployment of the GraphQL federation

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DEPLOYMENT_ENV=${1:-staging}
DOCKER_REGISTRY=${DOCKER_REGISTRY:-""}
IMAGE_TAG=${IMAGE_TAG:-$(git rev-parse --short HEAD)}
NAMESPACE=${NAMESPACE:-pothos-todo}

# Function to print colored output
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check prerequisites
check_prerequisites() {
    print_info "Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed"
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        print_error "Docker Compose is not installed"
        exit 1
    fi
    
    # Check environment file
    if [ ! -f ".env.$DEPLOYMENT_ENV" ]; then
        print_error "Environment file .env.$DEPLOYMENT_ENV not found"
        exit 1
    fi
    
    # Check if services are healthy locally
    if [ "$DEPLOYMENT_ENV" != "production" ]; then
        print_info "Running pre-deployment health checks..."
        ./scripts/health-check.sh || {
            print_error "Health checks failed"
            exit 1
        }
    fi
    
    print_success "Prerequisites check passed"
}

# Function to validate schemas
validate_schemas() {
    print_info "Validating federation schemas..."
    
    bun run src/federation/validate-schema.ts || {
        print_error "Schema validation failed"
        exit 1
    }
    
    print_success "Schema validation passed"
}

# Function to run tests
run_tests() {
    print_info "Running federation tests..."
    
    # Run schema tests
    ./scripts/test-federation-queries.sh || {
        print_error "Federation tests failed"
        exit 1
    }
    
    print_success "All tests passed"
}

# Function to build Docker images
build_images() {
    print_info "Building Docker images..."
    
    # Build all subgraph images
    docker compose -f docker-compose.yml -f docker-compose.prod.yml build \
        --build-arg BUILD_DATE=$(date -u +'%Y-%m-%dT%H:%M:%SZ') \
        --build-arg VCS_REF=$IMAGE_TAG \
        || {
        print_error "Failed to build images"
        exit 1
    }
    
    print_success "Docker images built successfully"
}

# Function to tag and push images
push_images() {
    if [ -z "$DOCKER_REGISTRY" ]; then
        print_warning "No Docker registry specified, skipping push"
        return
    fi
    
    print_info "Pushing images to registry..."
    
    # Tag and push each service
    for service in hive-gateway user-subgraph todo-subgraph ai-subgraph; do
        docker tag pothos-todo-$service:latest $DOCKER_REGISTRY/$NAMESPACE/$service:$IMAGE_TAG
        docker tag pothos-todo-$service:latest $DOCKER_REGISTRY/$NAMESPACE/$service:latest
        
        docker push $DOCKER_REGISTRY/$NAMESPACE/$service:$IMAGE_TAG
        docker push $DOCKER_REGISTRY/$NAMESPACE/$service:latest
    done
    
    print_success "Images pushed to registry"
}

# Function to deploy to staging
deploy_staging() {
    print_info "Deploying to staging environment..."
    
    # Export environment variables
    export $(cat .env.staging | xargs)
    
    # Deploy using docker-compose
    docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d
    
    # Wait for services to be healthy
    print_info "Waiting for services to be healthy..."
    sleep 30
    
    # Run health checks
    ./scripts/health-check.sh || {
        print_error "Staging deployment health check failed"
        exit 1
    }
    
    print_success "Staging deployment completed"
}

# Function to deploy to production
deploy_production() {
    print_info "Deploying to production environment..."
    
    # Confirm production deployment
    read -p "Are you sure you want to deploy to production? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
        print_warning "Production deployment cancelled"
        exit 0
    fi
    
    # Check Hive credentials
    if [ -z "$HIVE_CDN_ENDPOINT" ] || [ -z "$HIVE_CDN_KEY" ]; then
        print_error "Hive credentials not set for production"
        exit 1
    fi
    
    # Create backup
    print_info "Creating database backup..."
    ./scripts/backup-database.sh || {
        print_warning "Backup failed, continuing anyway..."
    }
    
    # Deploy with zero-downtime strategy
    print_info "Starting zero-downtime deployment..."
    
    # Deploy new instances
    docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --scale hive-gateway=2
    
    # Wait for new instances to be healthy
    sleep 60
    
    # Remove old instances
    docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --scale hive-gateway=1
    
    print_success "Production deployment completed"
}

# Function to rollback deployment
rollback() {
    print_error "Deployment failed, rolling back..."
    
    # Revert to previous image tag
    PREVIOUS_TAG=$(docker images --format "{{.Tag}}" | grep -v latest | head -n 2 | tail -n 1)
    
    if [ -n "$PREVIOUS_TAG" ]; then
        IMAGE_TAG=$PREVIOUS_TAG
        deploy_$DEPLOYMENT_ENV
    else
        print_error "No previous version found for rollback"
        exit 1
    fi
}

# Function to post-deployment tasks
post_deployment() {
    print_info "Running post-deployment tasks..."
    
    # Run migrations if needed
    if [ -f "./scripts/run-migrations.sh" ]; then
        ./scripts/run-migrations.sh
    fi
    
    # Warm up caches
    print_info "Warming up caches..."
    curl -s -X POST http://localhost:4000/graphql \
        -H "Content-Type: application/json" \
        -d '{"query":"{ __typename }"}' > /dev/null
    
    # Run smoke tests
    print_info "Running smoke tests..."
    ./scripts/test-federation-queries.sh || {
        print_error "Smoke tests failed"
        rollback
        exit 1
    }
    
    # Send deployment notification
    if [ -n "$SLACK_WEBHOOK" ]; then
        curl -X POST $SLACK_WEBHOOK \
            -H 'Content-Type: application/json' \
            -d "{\"text\":\"🚀 Federation deployed to $DEPLOYMENT_ENV (version: $IMAGE_TAG)\"}"
    fi
    
    print_success "Post-deployment tasks completed"
}

# Main deployment flow
main() {
    print_info "Starting federation deployment to $DEPLOYMENT_ENV..."
    print_info "Image tag: $IMAGE_TAG"
    
    # Pre-deployment
    check_prerequisites
    validate_schemas
    run_tests
    
    # Build and push
    build_images
    push_images
    
    # Deploy
    case $DEPLOYMENT_ENV in
        staging)
            deploy_staging
            ;;
        production)
            deploy_production
            ;;
        *)
            print_error "Unknown deployment environment: $DEPLOYMENT_ENV"
            exit 1
            ;;
    esac
    
    # Post-deployment
    post_deployment
    
    print_success "🎉 Federation deployment completed successfully!"
    print_info "Gateway URL: http://localhost:4000/graphql"
    print_info "Status Page: http://localhost:4444"
}

# Run main function
main