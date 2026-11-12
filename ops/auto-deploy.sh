#!/usr/bin/env bash
# Pull-based auto-deploy, run from cron every 5 minutes on the prod host.
#
# Deploys origin/$DEPLOY_BRANCH (default main) whenever it moves, except:
#   - while a scan is running (a restart drops its in-memory tracking) —
#     retried on the next tick;
#   - when the update adds a DB migration — those are applied by hand, so the
#     deploy waits for a person (see ops/README.md);
#   - a commit that already failed its health check — skipped until a newer
#     commit arrives.
# If the app doesn't serve /login again after the rebuild, it rolls back to
# the previous commit. Everything is logged to logs/deploy.log.
#
# The body is a function so bash parses all of it before `git merge` can
# rewrite this file mid-run.
set -uo pipefail

main() {
	cd "$(dirname "$0")/.." || exit 1
	OPS_TASK=deploy
	# shellcheck source=lib.sh
	. ops/lib.sh
	take_lock || exit 0

	local branch=${DEPLOY_BRANCH:-main}
	git fetch -q origin "$branch" || { log_once fetch-failed "ERROR: git fetch failed"; exit 1; }

	local current target short
	current=$(git rev-parse HEAD)
	target=$(git rev-parse "origin/$branch")
	[ "$current" = "$target" ] && exit 0
	short=$(git rev-parse --short "$target")

	if [ "$(cat logs/.bad-target 2>/dev/null)" = "$target" ]; then
		exit 0
	fi
	if git diff --name-only "$current" "$target" -- app/migrations | grep -q .; then
		log_once "$target migration" "HOLD $short: brings a new DB migration — apply it and deploy by hand"
		exit 0
	fi
	if scans_running; then
		log_once "$target scan" "WAIT $short: a scan is running, will retry"
		exit 0
	fi

	log "deploy $(git rev-parse --short "$current") -> $short: $(git log -1 --format=%s "$target")"
	if ! git merge -q --ff-only "origin/$branch" >>"$LOG" 2>&1; then
		log "ERROR: cannot fast-forward (local changes on the server?) — fix by hand"
		printf '%s' "$target" >logs/.bad-target
		exit 1
	fi

	# Build first (no restart), then re-check for a scan started meanwhile,
	# so the restart window is seconds instead of the whole build.
	if docker compose build >>"$LOG" 2>&1 && ! scans_running &&
		docker compose up -d >>"$LOG" 2>&1 && app_healthy; then
		log "OK $short is live"
		rm -f logs/.last-skip
		cleanup_docker
		exit 0
	fi

	if scans_running; then
		# A scan started during the build; nothing was restarted. Undo the
		# checkout so the next tick deploys cleanly once the scan ends.
		git reset -q --hard "$current"
		log_once "$target scan" "WAIT $short: a scan started during the build, will retry"
		exit 0
	fi

	log "FAILED $short: app not healthy — rolling back to $(git rev-parse --short "$current")"
	printf '%s' "$target" >logs/.bad-target
	git reset -q --hard "$current"
	if docker compose up -d --build >>"$LOG" 2>&1 && app_healthy; then
		log "rollback OK"
	else
		log "ROLLBACK FAILED — the app may be down, check by hand"
	fi
	cleanup_docker
	exit 1
}

main "$@"
