#!/usr/bin/env bash
# Manual deploy for commits the auto-deploy holds (new DB migrations), or to
# deploy right now instead of waiting for the next cron tick:
#
#     ~/odt-va-scan/ops/deploy-manual.sh
#
# It refuses to go ahead while a scan is running or before CI has passed,
# shows the migrations it will apply and asks before doing anything, applies
# them in order (each in one transaction), rebuilds, and rolls the code back
# if the app doesn't come up. Everything is logged to logs/deploy.log.
#
#   --skip-ci   deploy even if CI hasn't passed (e.g. GitHub is down)
#   --yes       don't ask for confirmation
set -uo pipefail

main() {
	cd "$(dirname "$0")/.." || exit 1
	OPS_TASK=manual
	# shellcheck source=lib.sh
	. ops/lib.sh

	local skip_ci=0 assume_yes=0 arg
	for arg in "$@"; do
		case "$arg" in
		--skip-ci) skip_ci=1 ;;
		--yes | -y) assume_yes=1 ;;
		*) echo "unknown option: $arg"; exit 2 ;;
		esac
	done

	say() { printf '%s\n' "$*"; }
	stop() { say "✋ $*"; exit 1; }

	take_lock || stop "another deploy or image refresh is running — try again in a minute"

	local branch=${DEPLOY_BRANCH:-main}
	git fetch -q origin "$branch" || stop "git fetch failed"
	local current target short
	current=$(git rev-parse HEAD)
	target=$(git rev-parse "origin/$branch")
	short=$(git rev-parse --short "$target")
	if [ "$current" = "$target" ]; then
		say "✓ already at $short — nothing to deploy"
		exit 0
	fi
	git merge-base --is-ancestor "$current" "$target" ||
		stop "origin/$branch is not ahead of the server's checkout (local commits?) — fix by hand"

	say "Deploy $(git rev-parse --short "$current") → $short"
	git log --oneline "$current..$target" | sed 's/^/   /'

	# 1. Scans: a restart drops the in-memory tracking of running ZAP/Nuclei scans.
	local running
	running=$(docker exec odt-va-scan-db-1 psql -U postgres -d va_scan -t -A -F ' · ' \
		-c "SELECT tool, target, to_char(created_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') FROM scan_jobs WHERE status='running'" 2>&1) ||
		stop "cannot ask the database whether scans are running: $running"
	if [ -n "$running" ]; then
		say "✋ scans are running — wait for them or cancel them on /scan, then run this again:"
		printf '%s\n' "$running" | sed 's/^/   /'
		exit 1
	fi

	# 2. CI must have passed for the exact commit being deployed.
	if [ "$skip_ci" = 1 ]; then
		say "⚠ skipping the CI check (--skip-ci)"
	else
		case "$(ci_state "$target")" in
		success) say "✓ CI passed" ;;
		pending) stop "CI is still running for $short — wait a few minutes (https://github.com/$(ci_repo)/actions)" ;;
		failure) stop "CI failed for $short — don't deploy it (https://github.com/$(ci_repo)/commit/$target)" ;;
		*) stop "cannot read CI status from GitHub — check https://github.com/$(ci_repo)/actions, then rerun with --skip-ci" ;;
		esac
	fi

	# 3. New migrations, in order.
	local migrations
	migrations=$(git diff --name-only --diff-filter=A "$current" "$target" -- 'app/migrations/*.sql' | sort)
	if [ -n "$migrations" ]; then
		say "Migrations to apply:"
		printf '%s\n' "$migrations" | sed 's/^/   /'
	else
		say "No new migrations."
	fi

	if [ "$assume_yes" != 1 ]; then
		local answer
		read -r -p "Go ahead? [y/N] " answer </dev/tty
		case "$answer" in y | Y | yes) ;; *) stop "cancelled — nothing changed" ;; esac
	fi

	log "manual deploy $(git rev-parse --short "$current") -> $short started"
	git merge -q --ff-only "origin/$branch" || stop "cannot fast-forward — fix by hand"

	local m
	for m in $migrations; do
		say "→ $m"
		if ! docker exec -i odt-va-scan-db-1 psql -U postgres -d va_scan -v ON_ERROR_STOP=1 -1 -q <"$m"; then
			log "manual deploy: migration $m FAILED — code reset to $(git rev-parse --short "$current")"
			git reset -q --hard "$current"
			stop "migration $m failed and was rolled back; the app was not touched. Earlier migrations in this run stay applied."
		fi
		log "manual deploy: applied $m"
	done

	say "→ building…"
	if ! docker compose build >>"$LOG" 2>&1; then
		git reset -q --hard "$current"
		log "manual deploy: build FAILED — code reset"
		stop "build failed (see logs/deploy.log); code reset, the running app was not touched"
	fi
	scans_running && {
		git reset -q --hard "$current"
		stop "a scan started during the build — nothing was restarted; run this again when it ends"
	}

	say "→ restarting…"
	if docker compose up -d >>"$LOG" 2>&1 && app_healthy; then
		log "OK $short is live (manual)"
		rm -f logs/.bad-target logs/.last-skip
		cleanup_docker
		say "✓ $short is live"
		exit 0
	fi

	log "manual deploy: $short not healthy — rolling back code to $(git rev-parse --short "$current")"
	git reset -q --hard "$current"
	docker compose up -d --build >>"$LOG" 2>&1 && app_healthy && say "↩ rolled back; the old version is running" ||
		say "‼ rollback failed too — the app may be down, check by hand"
	[ -n "$migrations" ] && say "Note: migrations applied in this run were NOT undone."
	exit 1
}

main "$@"
