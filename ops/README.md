# Automatic deploys and patching (prod: 10.101.118.167)

## What runs on its own

| What | When | How |
|---|---|---|
| Deploy new commits on `main` | every 5 min (cron, user `phonhat`) | `ops/auto-deploy.sh` |
| Rebuild on fresh postgres / nginx / node images | once a week, ~03:00 Bangkok (cron) | `ops/refresh-images.sh` |
| Ubuntu security updates | daily, 02:30 Bangkok | `unattended-upgrades` (no automatic reboot) |
| npm / Docker base-image updates | weekly pull requests | Dependabot (`.github/dependabot.yml`) |
| Tests, build, migrations, Docker build | every push and pull request | GitHub Actions (`.github/workflows/ci.yml`) |

Every deploy, skip and rollback is written to `logs/deploy.log` on the server:

    tail -n 30 ~/odt-va-scan/logs/deploy.log

## Rules the deploy script follows

- **Deploys only commits CI passed.** Every push runs `.github/workflows/ci.yml`
  on GitHub Actions: unit tests, the production build, every migration on a
  fresh PostgreSQL 16, and the Docker image build. The deploy waits while CI
  is running and skips a commit whose CI failed (logged as `SKIP … CI failed`).
  If GitHub's API is unreachable it waits; to deploy anyway, `touch
  logs/.skip-ci` (and `rm` it afterwards). Check CI by hand before a manual
  deploy: https://github.com/FIGOHIGHWAY/ODT-VA-Folder-summary/actions
- **Never restarts while a scan is running.** It waits and retries on the next
  tick.
- **Holds commits that touch `app/migrations/`.** Finish those with one
  command; it refuses while a scan is running or before CI has passed, lists
  the migrations, asks before changing anything, applies them in order (each
  in one transaction), rebuilds, and rolls the code back if the app doesn't
  come up:

      ~/odt-va-scan/ops/deploy-manual.sh

  The same script deploys any commit immediately instead of waiting for the
  next 5-minute tick.

- **Rolls back** to the previous commit if `/login` doesn't answer 200 after
  the rebuild, and won't retry that commit until a newer one is pushed.

## Scanner VMs

Scan traffic leaves from these addresses — use them for firewall allowlists.

| Tool | IP | How the app reaches it |
|---|---|---|
| OWASP ZAP | 10.101.118.175 | API via SSH tunnel (`zap-tunnel.service`), DNS-pin helper via SSH |
| OpenVAS | 10.101.118.177 | GMP via SSH tunnel (`openvas-tunnel.service`) |
| Nuclei | 10.101.118.178 | SSH, runs the CLI |
| Nessus | 10.101.118.179 | HTTPS API on 8834 |

## Reboots

Kernel updates need a reboot, which is not automatic (it would drop running
scans and the scanner tunnels). When `/var/run/reboot-required` exists, reboot
by hand at a quiet time.

## Turning it off

    crontab -e        # comment out the two va-scan lines
