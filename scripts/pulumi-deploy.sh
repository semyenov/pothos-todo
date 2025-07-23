#!/bin/bash

# Pulumi Docker Infrastructure Deployment Script
# Automates the deployment of Pothos GraphQL Todo infrastructure using Pulumi

set -euo pipefail

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PULUMI_DIR="$PROJECT_ROOT/pulumi"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Print usage information
print_usage() {
    cat << EOF
Usage: $0 [OPTIONS] <COMMAND>

Commands:
    up          Deploy infrastructure
    down        Destroy infrastructure
    preview     Preview changes without applying
    refresh     Refresh state without making changes
    status      Show current stack status
    logs        Show deployment logs
    config      Manage configuration
    backup      Backup current state

Options:
    -s, --stack STACK       Target stack (dev, staging, prod) [default: dev]
    -e, --env ENV          Environment override
    -d, --dry-run          Preview changes only
    -f, --force            Force operation without confirmation
    -v, --verbose          Enable verbose output
    -h, --help             Show this help message

Environment Variables:
    PULUMI_ACCESS_TOKEN    Pulumi access token for cloud backend
    DOCKER_REGISTRY        Docker registry for images
    HIVE_CDN_ENDPOINT      GraphQL Hive CDN endpoint
    HIVE_CDN_KEY          GraphQL Hive CDN API key

Examples:
    $0 up -s dev                     Deploy to development
    $0 preview -s prod               Preview production changes
    $0 down -s staging --force       Destroy staging without confirmation
    $0 config -s prod                Configure production settings
EOF
}

# Parse command line arguments
STACK="dev"
ENVIRONMENT=""
DRY_RUN=false
FORCE=false
VERBOSE=false
COMMAND=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -s|--stack)
            STACK="$2"
            shift 2
            ;;
        -e|--env)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -d|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -f|--force)
            FORCE=true
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -h|--help)
            print_usage
            exit 0
            ;;
        up|down|preview|refresh|status|logs|config|backup)
            COMMAND="$1"
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            print_usage
            exit 1
            ;;
    esac
done

# Validate required command
if [[ -z "$COMMAND" ]]; then
    log_error "Command is required"
    print_usage
    exit 1
fi

# Set environment if not specified
if [[ -z "$ENVIRONMENT" ]]; then
    case "$STACK" in
        dev|development)
            ENVIRONMENT="development"
            ;;
        staging|stage)
            ENVIRONMENT="staging"
            ;;
        prod|production)
            ENVIRONMENT="production"
            ;;
        *)
            ENVIRONMENT="development"
            log_warning "Unknown stack '$STACK', defaulting to development environment"
            ;;
    esac
fi

# Set verbose mode
if [[ "$VERBOSE" == "true" ]]; then
    set -x
fi

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check if Pulumi is installed
    if ! command -v pulumi &> /dev/null; then
        log_error "Pulumi is not installed. Please install it from https://www.pulumi.com/docs/get-started/install/"
        exit 1
    fi
    
    # Check if Docker is running
    if ! docker info &> /dev/null; then
        log_error "Docker is not running. Please start Docker daemon."
        exit 1
    fi
    
    # Check if Bun is installed
    if ! command -v bun &> /dev/null; then
        log_error "Bun is not installed. Please install it from https://bun.sh/"
        exit 1
    fi
    
    # Check if required directories exist
    if [[ ! -d "$PULUMI_DIR" ]]; then
        log_error "Pulumi directory not found: $PULUMI_DIR"
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Initialize Pulumi stack
init_stack() {
    log_info "Initializing Pulumi stack: $STACK"
    
    cd "$PULUMI_DIR"
    
    # Login to Pulumi (uses local backend by default)
    if [[ -n "${PULUMI_ACCESS_TOKEN:-}" ]]; then
        pulumi login
    else
        pulumi login --local
    fi
    
    # Select or create stack
    if pulumi stack ls | grep -q "^${STACK}\\s"; then
        pulumi stack select "$STACK"
        log_info "Selected existing stack: $STACK"
    else
        pulumi stack init "$STACK"
        log_success "Created new stack: $STACK"
    fi
    
    # Set configuration
    pulumi config set environment "$ENVIRONMENT"
    
    if [[ -n "${DOCKER_REGISTRY:-}" ]]; then
        pulumi config set dockerRegistry "$DOCKER_REGISTRY"
    fi
    
    if [[ -n "${HIVE_CDN_ENDPOINT:-}" ]]; then
        pulumi config set hiveCdnEndpoint "$HIVE_CDN_ENDPOINT"
    fi
    
    if [[ -n "${HIVE_CDN_KEY:-}" ]]; then
        pulumi config set --secret hiveCdnKey "$HIVE_CDN_KEY"
    fi
}

# Deploy infrastructure
deploy_infrastructure() {
    log_info "Deploying infrastructure to $ENVIRONMENT environment..."
    
    cd "$PULUMI_DIR"
    
    local deploy_args=()
    
    if [[ "$DRY_RUN" == "true" ]] || [[ "$COMMAND" == "preview" ]]; then
        deploy_args+=("preview")
        log_info "Running in preview mode - no changes will be applied"
    else
        deploy_args+=("up")
        if [[ "$FORCE" == "true" ]]; then
            deploy_args+=("--yes")
        fi
    fi
    
    if [[ "$VERBOSE" == "true" ]]; then
        deploy_args+=("--verbose")
    fi
    
    # Install dependencies
    log_info "Installing Pulumi dependencies..."
    bun install
    
    # Run Pulumi command
    log_info "Running: pulumi ${deploy_args[*]}"
    pulumi "${deploy_args[@]}"
    
    if [[ "$COMMAND" != "preview" && "$DRY_RUN" != "true" ]]; then
        log_success "Infrastructure deployment completed"
        
        # Show outputs
        log_info "Deployment outputs:"
        pulumi stack output --json | jq .
    fi
}

# Destroy infrastructure
destroy_infrastructure() {
    log_info "Destroying infrastructure in $ENVIRONMENT environment..."
    
    if [[ "$FORCE" != "true" ]]; then
        echo -n "Are you sure you want to destroy the infrastructure? (y/N): "
        read -r confirmation
        if [[ ! "$confirmation" =~ ^[Yy]$ ]]; then
            log_info "Destruction cancelled"
            exit 0
        fi
    fi
    
    cd "$PULUMI_DIR"
    
    local destroy_args=("destroy")
    
    if [[ "$FORCE" == "true" ]]; then
        destroy_args+=("--yes")
    fi
    
    if [[ "$VERBOSE" == "true" ]]; then
        destroy_args+=("--verbose")
    fi
    
    pulumi "${destroy_args[@]}"
    
    log_success "Infrastructure destruction completed"
}

# Show stack status
show_status() {
    log_info "Stack status for $STACK:"
    
    cd "$PULUMI_DIR"
    
    echo
    log_info "Stack information:"
    pulumi stack --show-urns
    
    echo
    log_info "Configuration:"
    pulumi config
    
    echo
    log_info "Outputs:"
    pulumi stack output --json | jq .
    
    echo
    log_info "Resources:"
    pulumi stack --show-urns | head -20
}

# Refresh stack state
refresh_state() {
    log_info "Refreshing stack state..."
    
    cd "$PULUMI_DIR"
    
    local refresh_args=("refresh")
    
    if [[ "$FORCE" == "true" ]]; then
        refresh_args+=("--yes")
    fi
    
    pulumi "${refresh_args[@]}"
    
    log_success "Stack state refreshed"
}

# Show deployment logs
show_logs() {
    log_info "Showing deployment logs..."
    
    cd "$PULUMI_DIR"
    
    pulumi logs --follow
}

# Manage configuration
manage_config() {
    log_info "Configuration management for $STACK stack:"
    
    cd "$PULUMI_DIR"
    
    echo
    log_info "Current configuration:"
    pulumi config
    
    echo
    log_info "Available configuration options:"
    echo "  environment        - Deployment environment (development, staging, production)"
    echo "  dockerRegistry     - Docker registry for custom images"
    echo "  namespace          - Project namespace for resources"
    echo "  hiveCdnEndpoint    - GraphQL Hive CDN endpoint"
    echo "  hiveCdnKey         - GraphQL Hive CDN API key (secret)"
    
    echo
    echo "To set configuration values:"
    echo "  pulumi config set <key> <value>"
    echo "  pulumi config set --secret <key> <secret-value>"
}

# Backup current state
backup_state() {
    log_info "Backing up current state..."
    
    cd "$PULUMI_DIR"
    
    local backup_dir="$PROJECT_ROOT/backups/pulumi"
    local timestamp=$(date +"%Y%m%d_%H%M%S")
    local backup_file="$backup_dir/${STACK}_${timestamp}.json"
    
    mkdir -p "$backup_dir"
    
    pulumi stack export --file "$backup_file"
    
    log_success "State backup saved to: $backup_file"
}

# Cleanup on exit
cleanup() {
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
        log_error "Script failed with exit code $exit_code"
    fi
    exit $exit_code
}

trap cleanup EXIT

# Main execution
main() {
    log_info "Pulumi Docker Infrastructure Deployment"
    log_info "Stack: $STACK | Environment: $ENVIRONMENT | Command: $COMMAND"
    
    check_prerequisites
    init_stack
    
    case "$COMMAND" in
        up)
            deploy_infrastructure
            ;;
        down)
            destroy_infrastructure
            ;;
        preview)
            deploy_infrastructure
            ;;
        refresh)
            refresh_state
            ;;
        status)
            show_status
            ;;
        logs)
            show_logs
            ;;
        config)
            manage_config
            ;;
        backup)
            backup_state
            ;;
        *)
            log_error "Unknown command: $COMMAND"
            print_usage
            exit 1
            ;;
    esac
}

# Run main function
main "$@"