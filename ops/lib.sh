# Shared helpers for ops/auto-deploy.sh and ops/refresh-images.sh.
# Sourced, not run. Expects the caller to have cd'd to the repo root.

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

LOG=logs/deploy.log
mkdir -p logs

log() {
	printf '%s [%s] %s\n' "$(date -u '+%Y-%m-%d %H:%M:%S UTC')" "$OPS_TASK" "$*" >>"$LOG"
}

# Log a "skipped" reason once per (target, reason) instead of on every cron
# tick, so a long-running scan doesn't fill the log with identical lines.
log_once() {
	local key="$1"
	shift
	if [ "$(cat logs/.last-skip 2>/dev/null)" != "$key" ]; then
		log "$*"
		printf '%s' "$key" >logs/.last-skip
	fi
}

# Hold the same lock for every ops task so a deploy and an image refresh
# never rebuild at the same time.
take_lock() {
	exec 9>logs/.ops.lock
	flock -n 9
}

# Restarting the app drops the in-memory tracking of running scans, so never
# restart while one is running. A failed query counts as "busy" to stay safe.
scans_running() {
	local n
	n=$(docker exec odt-va-scan-db-1 psql -U postgres -d va_scan -t -A \
		-c "SELECT count(*) FROM scan_jobs WHERE status='running'" 2>/dev/null) || return 0
	[ "$n" != 0 ]
}

# Wait for the app to serve the login page again (through nginx's network).
app_healthy() {
	local i code
	for i in $(seq 1 40); do
		code=$(docker exec odt-va-scan-nginx-1 wget -qO /dev/null -S http://app:3000/login 2>&1 |
			awk '/HTTP\//{print $2; exit}')
		[ "$code" = 200 ] && return 0
		sleep 3
	done
	return 1
}

# Result of the GitHub Actions "CI" workflow (.github/workflows/ci.yml) for a
# commit: success | failure | pending | unknown. The repo is public, so the
# API needs no token (60 requests/hour per IP; the deploy only asks while a
# new commit is waiting). Plain grep instead of jq/python so it needs nothing
# beyond curl on the host.
CI_WORKFLOW_PATH=.github/workflows/ci.yml

ci_repo() {
	git config --get remote.origin.url | sed -E 's#^(https://github.com/|git@github.com:)##; s#\.git$##'
}

ci_count() { # <sha> <status filter> → number of matching CI runs, or empty on API error
	local json
	json=$(curl -fsS --max-time 15 -H 'Accept: application/vnd.github+json' \
		"https://api.github.com/repos/$(ci_repo)/actions/runs?head_sha=$1&status=$2&per_page=50" 2>/dev/null) || return 0
	printf '%s\n' "$json" | grep -c "\"path\": \"$CI_WORKFLOW_PATH" || true
}

ci_state() {
	local sha=$1 ok done
	command -v curl >/dev/null || { echo unknown; return; }
	ok=$(ci_count "$sha" success)
	[ -z "$ok" ] && { echo unknown; return; }
	[ "$ok" -gt 0 ] && { echo success; return; }
	done=$(ci_count "$sha" completed)
	[ -n "$done" ] && [ "$done" -gt 0 ] && { echo failure; return; }
	echo pending
}

# The root disk is small (~8 GB); drop build cache and dangling images after
# every rebuild or it fills up within weeks.
cleanup_docker() {
	docker builder prune -f >/dev/null 2>&1 || true
	docker image prune -f >/dev/null 2>&1 || true
}
