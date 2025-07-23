#!/bin/bash

# Federation Test Runner Script
# This script runs the complete federation test suite

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Parse arguments
SUITE=""
TEST=""
VERBOSE=""
BAIL=""
COVERAGE=""
ONLY=""

while [[ $# -gt 0 ]]; do
  case $1 in
    -s|--suite)
      SUITE="--suite $2"
      shift 2
      ;;
    -t|--test)
      TEST="--test $2"
      shift 2
      ;;
    -v|--verbose)
      VERBOSE="--verbose"
      shift
      ;;
    -b|--bail)
      BAIL="--bail"
      shift
      ;;
    -c|--coverage)
      COVERAGE="--coverage"
      shift
      ;;
    --only)
      ONLY="--only"
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  -s, --suite <name>    Run specific test suite"
      echo "  -t, --test <name>     Run specific test by name"
      echo "  -v, --verbose         Verbose output"
      echo "  -b, --bail            Stop on first failure"
      echo "  -c, --coverage        Generate coverage report"
      echo "  --only                Run only tests marked with .only"
      echo "  -h, --help            Show this help message"
      echo ""
      echo "Examples:"
      echo "  $0                    Run all tests"
      echo "  $0 -s user            Run user subgraph tests"
      echo "  $0 -t login           Run tests containing 'login'"
      echo "  $0 -v -b              Run with verbose output and bail on failure"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

echo -e "${BLUE}🧪 Federation Test Suite${NC}"
echo "========================"

# Check if services are running
echo -e "${BLUE}Checking services...${NC}"
if ! ./scripts/health-check.sh > /dev/null 2>&1; then
    echo -e "${YELLOW}Services not healthy. Starting them...${NC}"
    docker compose up -d
    echo "Waiting for services to be ready..."
    sleep 15
fi

# Create test report directory
mkdir -p test-reports

# Run pre-test setup
echo -e "${BLUE}Running pre-test setup...${NC}"

# Seed test data
if [ -f "./scripts/seed-test-data.sh" ]; then
    ./scripts/seed-test-data.sh
fi

# Clear previous test results
rm -f federation-test-report.json

# Build test command
TEST_CMD="bun run src/federation/run-tests.ts $SUITE $TEST $VERBOSE $BAIL $COVERAGE $ONLY"

echo -e "${BLUE}Running tests...${NC}"
echo -e "${YELLOW}Command: $TEST_CMD${NC}"
echo ""

# Run tests with error handling
if $TEST_CMD; then
    EXIT_CODE=0
    echo ""
    echo -e "${GREEN}✅ All tests passed!${NC}"
else
    EXIT_CODE=$?
    echo ""
    echo -e "${RED}❌ Some tests failed!${NC}"
fi

# Generate HTML report if coverage was requested
if [ ! -z "$COVERAGE" ] && [ -f "federation-test-report.json" ]; then
    echo -e "${BLUE}Generating coverage report...${NC}"
    
    # Create HTML report
    cat > test-reports/index.html << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Federation Test Report</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 { color: #333; }
        .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin: 20px 0;
        }
        .metric {
            padding: 20px;
            border-radius: 8px;
            text-align: center;
        }
        .metric.passed { background: #d4edda; color: #155724; }
        .metric.failed { background: #f8d7da; color: #721c24; }
        .metric.skipped { background: #fff3cd; color: #856404; }
        .metric h3 { margin: 0; font-size: 36px; }
        .metric p { margin: 5px 0 0 0; }
        .test-results {
            margin-top: 30px;
        }
        .test {
            padding: 10px;
            margin: 5px 0;
            border-radius: 5px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .test.passed { background: #d4edda; }
        .test.failed { background: #f8d7da; }
        .test.skipped { background: #fff3cd; }
        .duration { color: #666; font-size: 14px; }
        .error { color: #721c24; font-size: 14px; margin-top: 5px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Federation Test Report</h1>
        <div id="report-content"></div>
    </div>
    <script>
        fetch('../federation-test-report.json')
            .then(res => res.json())
            .then(data => {
                const content = document.getElementById('report-content');
                content.innerHTML = \`
                    <p>Generated: \${new Date(data.timestamp).toLocaleString()}</p>
                    <p>Duration: \${(data.duration / 1000).toFixed(2)}s</p>
                    
                    <div class="summary">
                        <div class="metric passed">
                            <h3>\${data.passed}</h3>
                            <p>Passed</p>
                        </div>
                        <div class="metric failed">
                            <h3>\${data.failed}</h3>
                            <p>Failed</p>
                        </div>
                        <div class="metric skipped">
                            <h3>\${data.skipped}</h3>
                            <p>Skipped</p>
                        </div>
                    </div>
                    
                    <div class="test-results">
                        <h2>Test Results</h2>
                        \${data.results.map(result => \`
                            <div class="test \${result.status}">
                                <div>
                                    <strong>\${result.suite}</strong>: \${result.test}
                                    \${result.error ? \`<div class="error">\${result.error}</div>\` : ''}
                                </div>
                                <span class="duration">\${result.duration}ms</span>
                            </div>
                        \`).join('')}
                    </div>
                \`;
            });
    </script>
</body>
</html>
EOF
    
    echo -e "${GREEN}Coverage report generated: test-reports/index.html${NC}"
fi

# Show test report location
if [ -f "federation-test-report.json" ]; then
    echo ""
    echo -e "${BLUE}📄 Test report saved to: federation-test-report.json${NC}"
    
    # Show failed tests if any
    if [ $EXIT_CODE -ne 0 ]; then
        echo ""
        echo -e "${RED}Failed tests:${NC}"
        jq -r '.results[] | select(.status == "failed") | "  - \(.suite): \(.test)\n    Error: \(.error)"' federation-test-report.json
    fi
fi

# Clean up test data (optional)
if [ -f "./scripts/cleanup-test-data.sh" ]; then
    echo -e "${BLUE}Cleaning up test data...${NC}"
    ./scripts/cleanup-test-data.sh
fi

exit $EXIT_CODE