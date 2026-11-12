#!/usr/bin/env bash
# Weekly security refresh of the Docker images, run nightly from cron.
#
# Pulls the latest postgres/nginx images and rebuilds the app on a freshly
# pulled node base image, so OS-level fixes in those images reach prod. Runs
# at most once every 6 days; a night skipped because a scan was running is
# retried the next night. Logged to logs/deploy.log.
set -uo pipefail

main() {
	cd "$(dirname "$0")/.." || exit 1
	OPS_TASK=refresh
	# shellcheck source=lib.sh
	. ops/lib.sh
	take_lock || exit 0

	if [ -n "$(find logs/.last-refresh -mtime -6 2>/dev/null)" ]; then
		exit 0
	fi
	if scans_running; then
		log "WAIT: a scan is running, will retry tomorrow"
		exit 0
	fi

	log "pulling base images and rebuilding"
	if ! docker compose pull db nginx >>"$LOG" 2>&1 || ! docker compose build --pull >>"$LOG" 2>&1; then
		log "ERROR: pull/build failed — prod left untouched"
		cleanup_docker
		exit 1
	fi
	if scans_running; then
		log "WAIT: a scan started during the build, will retry tomorrow"
		exit 0
	fi
	if docker compose up -d >>"$LOG" 2>&1 && app_healthy; then
		log "OK images refreshed"
		touch logs/.last-refresh
	else
		log "FAILED: app not healthy after image refresh — check by hand"
	fi
	cleanup_docker
}

main "$@"
