#!/usr/bin/env bash
# Build both images on this Mac for linux/amd64, ship them to the VPS, restart the stack.
# Usage: deploy/deploy.sh [--dry-run]
# Env:   DEPLOY_HOST (ssh alias, default omni), DEPLOY_DIR (default /opt/tracker)
set -euo pipefail

HOST="${DEPLOY_HOST:-omni}"
REMOTE_DIR="${DEPLOY_DIR:-/opt/tracker}"
DRY_RUN=0
KEEP_TAGS=3

case "${1:-}" in
  "") ;;
  --dry-run) DRY_RUN=1 ;;
  *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."

TAG="$(git rev-parse --short HEAD)"
if [[ -n "$(git status --porcelain)" ]]; then
  TAG="${TAG}-dirty-$(date +%Y%m%d%H%M%S)"
  echo "warning: working tree has uncommitted changes, deploying as $TAG" >&2
fi

# The omni ssh config sets RemoteCommand and RequestTTY; both break scripted use.
SSH="ssh -o RemoteCommand=none -o RequestTTY=no $HOST"

step() {
  local title="$1" cmd="$2"
  echo "==> $title"
  echo "    $cmd"
  if [[ $DRY_RUN -eq 0 ]]; then eval "$cmd"; fi
}

[[ $DRY_RUN -eq 1 ]] && echo "(dry run: nothing below is executed)"
echo "tag: $TAG  host: $HOST  dir: $REMOTE_DIR"

for app in api web; do
  step "build traccia-$app (linux/amd64)" \
    "docker buildx build --platform linux/amd64 --load -f apps/$app/Dockerfile -t traccia-$app:$TAG -t traccia-$app:latest ."
done

step "check the VPS is ready (.env present)" \
  "$SSH 'test -f $REMOTE_DIR/.env' || { echo 'missing $REMOTE_DIR/.env on $HOST (see deploy/.env.example)' >&2; exit 1; }"

# The pre-rename compose project is called `tracker`; starting `traccia` beside it would fight over the ports.
step "check the pre-rename stack is not running" \
  "[ -z \"\$($SSH 'docker ps -q --filter label=com.docker.compose.project=tracker')\" ] || { echo 'the old tracker compose project is still running on $HOST; stop it first (see the rename runbook in the PR / deploy/README.md)' >&2; exit 1; }"

step "ship images" \
  "docker save traccia-api:$TAG traccia-web:$TAG traccia-api:latest traccia-web:latest | $SSH docker load"

step "copy compose file" \
  "$SSH 'cat > $REMOTE_DIR/docker-compose.yml' < deploy/docker-compose.yml"

step "start the new version" \
  "$SSH 'cd $REMOTE_DIR && echo \"previous tag: \$(tail -n1 deployed-tags 2>/dev/null || echo none)\" && TAG=$TAG docker compose up -d --remove-orphans'"

# Only a healthy release is recorded, so deployed-tags lists known-good rollback targets.
step "wait for /healthz" \
  "$SSH 'for i in \$(seq 1 30); do curl -fsS http://127.0.0.1:8787/healthz && echo $TAG >> $REMOTE_DIR/deployed-tags && exit 0; sleep 2; done; echo \"api did not become healthy\" >&2; docker compose -f $REMOTE_DIR/docker-compose.yml logs --tail 50 api >&2; exit 1'"

# Keep the newest $KEEP_TAGS healthy tags and drop older images. rmi fails (ignored) for an image still in use.
step "prune old images" \
  "$SSH 'cd $REMOTE_DIR && keep=\$(tail -n $KEEP_TAGS deployed-tags) && for img in traccia-api traccia-web; do docker images \$img --format \"{{.Tag}}\" | grep -vx latest | while read -r t; do echo \"\$keep\" | grep -qx \"\$t\" || docker rmi \$img:\$t || true; done; done'"

echo "done: $TAG"
echo "rollback: $SSH 'cd $REMOTE_DIR && TAG=<previous tag> docker compose up -d'"
