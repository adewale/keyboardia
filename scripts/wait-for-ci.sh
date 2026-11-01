#!/bin/bash
#
# wait-for-ci.sh - Monitor GitHub CI status until completion
#
# Usage: ./scripts/wait-for-ci.sh [OPTIONS]
#
# Options:
#   --pr <number>      PR number (default: current branch's PR)
#   --run <run_id>     Specific run ID to monitor
#   --interval <secs>  Polling interval in seconds (default: 15)
#   --timeout <mins>   Timeout in minutes (default: 30)
#   --merge            Auto-merge PR when all checks pass
#   --quiet            Minimal output
#   --help             Show this help message
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Default values
INTERVAL=15
TIMEOUT_MINS=30
MERGE=false
QUIET=false
PR_NUMBER=""
RUN_ID=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --pr)
      PR_NUMBER="$2"
      shift 2
      ;;
    --run)
      RUN_ID="$2"
      shift 2
      ;;
    --interval)
      INTERVAL="$2"
      shift 2
      ;;
    --timeout)
      TIMEOUT_MINS="$2"
      shift 2
      ;;
    --merge)
      MERGE=true
      shift
      ;;
    --quiet)
      QUIET=true
      shift
      ;;
    --help)
      head -20 "$0" | tail -16
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Calculate timeout in seconds
TIMEOUT_SECS=$((TIMEOUT_MINS * 60))

# Get the run ID if not specified
get_run_id() {
  if [[ -n "$RUN_ID" ]]; then
    echo "$RUN_ID"
    return
  fi

  if [[ -n "$PR_NUMBER" ]]; then
    gh pr view "$PR_NUMBER" --json headRefName --jq '.headRefName' | xargs -I {} gh run list --branch {} --limit 1 --json databaseId --jq '.[0].databaseId'
  else
    # Get from current branch
    gh run list --branch "$(git branch --show-current)" --limit 1 --json databaseId --jq '.[0].databaseId'
  fi
}

# Get status of all jobs
get_jobs_status() {
  local run_id=$1
  gh run view "$run_id" --json jobs --jq '.jobs[] | "\(.name)|\(.status)|\(.conclusion)"'
}

# Get overall run status
get_run_status() {
  local run_id=$1
  gh run view "$run_id" --json status,conclusion --jq '"\(.status)|\(.conclusion)"'
}

# Format job status for display
format_job() {
  local name=$1
  local status=$2
  local conclusion=$3

  local icon=""
  local color=""

  case "$status" in
    completed)
      case "$conclusion" in
        success)
          icon="✓"
          color="$GREEN"
          ;;
        failure)
          icon="✗"
          color="$RED"
          ;;
        skipped)
          icon="○"
          color="$YELLOW"
          ;;
        cancelled)
          icon="⊘"
          color="$YELLOW"
          ;;
        *)
          icon="?"
          color="$YELLOW"
          ;;
      esac
      ;;
    in_progress)
      icon="◉"
      color="$BLUE"
      ;;
    queued|pending|waiting)
      icon="○"
      color="$CYAN"
      ;;
    *)
      icon="?"
      color="$NC"
      ;;
  esac

  printf "${color}${icon}${NC} %-25s ${color}%s${NC}" "$name" "$status"
  if [[ "$status" == "completed" && -n "$conclusion" ]]; then
    printf " (${color}%s${NC})" "$conclusion"
  fi
  echo
}

# Print summary line
print_summary() {
  local passed=$1
  local failed=$2
  local pending=$3
  local total=$4

  echo -ne "\r${BOLD}Status:${NC} "
  [[ $passed -gt 0 ]] && echo -ne "${GREEN}${passed} passed${NC} "
  [[ $failed -gt 0 ]] && echo -ne "${RED}${failed} failed${NC} "
  [[ $pending -gt 0 ]] && echo -ne "${BLUE}${pending} pending${NC} "
  echo -ne "| ${total} total"
}

# Main monitoring loop
main() {
  local run_id
  run_id=$(get_run_id)

  if [[ -z "$run_id" ]]; then
    echo -e "${RED}Error: Could not find a CI run to monitor${NC}"
    exit 1
  fi

  echo -e "${BOLD}Monitoring CI run:${NC} $run_id"
  echo -e "${BOLD}Polling interval:${NC} ${INTERVAL}s"
  echo -e "${BOLD}Timeout:${NC} ${TIMEOUT_MINS}m"
  [[ "$MERGE" == "true" ]] && echo -e "${BOLD}Auto-merge:${NC} enabled"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  local start_time=$(date +%s)
  local iteration=0

  while true; do
    iteration=$((iteration + 1))
    local elapsed=$(( $(date +%s) - start_time ))

    # Check timeout
    if [[ $elapsed -ge $TIMEOUT_SECS ]]; then
      echo -e "\n${RED}Timeout reached after ${TIMEOUT_MINS} minutes${NC}"
      exit 1
    fi

    # Get current status
    local run_status
    run_status=$(get_run_status "$run_id")
    local overall_status=$(echo "$run_status" | cut -d'|' -f1)
    local overall_conclusion=$(echo "$run_status" | cut -d'|' -f2)

    # Get job statuses
    local jobs
    jobs=$(get_jobs_status "$run_id")

    local passed=0 failed=0 pending=0 total=0

    if [[ "$QUIET" != "true" ]]; then
      # Clear screen for clean display (optional)
      echo -e "\n${BOLD}[$(date '+%H:%M:%S')] Check #${iteration} (${elapsed}s elapsed)${NC}"
    fi

    while IFS='|' read -r name status conclusion; do
      total=$((total + 1))
      case "$status" in
        completed)
          case "$conclusion" in
            success) passed=$((passed + 1)) ;;
            failure) failed=$((failed + 1)) ;;
            *) pending=$((pending + 1)) ;;
          esac
          ;;
        *)
          pending=$((pending + 1))
          ;;
      esac

      if [[ "$QUIET" != "true" ]]; then
        format_job "$name" "$status" "$conclusion"
      fi
    done <<< "$jobs"

    # Print summary
    if [[ "$QUIET" == "true" ]]; then
      print_summary $passed $failed $pending $total
    else
      echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
      print_summary $passed $failed $pending $total
      echo
    fi

    # Check if completed
    if [[ "$overall_status" == "completed" ]]; then
      echo
      if [[ "$overall_conclusion" == "success" ]]; then
        echo -e "${GREEN}${BOLD}✓ All checks passed!${NC}"

        if [[ "$MERGE" == "true" ]]; then
          echo -e "${BLUE}Merging PR...${NC}"
          if gh pr merge --squash --delete-branch; then
            echo -e "${GREEN}${BOLD}✓ PR merged successfully!${NC}"
          else
            echo -e "${RED}Failed to merge PR${NC}"
            exit 1
          fi
        fi

        exit 0
      else
        echo -e "${RED}${BOLD}✗ CI failed with conclusion: $overall_conclusion${NC}"
        echo -e "\nView logs: gh run view $run_id --log-failed"
        exit 1
      fi
    fi

    # Wait before next check
    sleep "$INTERVAL"
  done
}

# Run main
main
