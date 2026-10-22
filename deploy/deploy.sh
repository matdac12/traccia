#!/usr/bin/env bash
# Build both images and deploy them to the VPS.
#
#   deploy/deploy.sh          build on this machine (use on the Mac), ship over ssh, restart
#   deploy/deploy.sh --ci     pull the CI-built images from GHCR, restart (use when the Mac is not available)
#
# Usage: deploy/deploy.sh [--ci] [--dry-run]
# Env:   DEPLOY_HOST (required: ssh alias or hostname of your server), DEPLOY_DIR (default /opt/tracker),
#        GHCR_PREFIX (--ci only; default ghcr.io/<owner>/traccia, owner read from `origin`)
set -euo pipefail

HOST="${DEPLOY_HOST:?set DEPLOY_HOST to the ssh alias or hostname of your server}"
REMOTE_DIR="${DEPLOY_DIR:-/opt/tracker}"
DRY_RUN=0
KEEP_TAGS=3
MODE=local

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --ci) MODE=ci ;;
    *) echo "usage: $0 [--ci] [--dry-run]" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."

if [[ "$MODE" == local ]]; then
  TAG="$(git rev-parse --short HEAD)"
  if [[ -n "$(git status --porcelain)" ]]; then
    TAG="${TAG}-dirty-$(date +%Y%m%d%H%M%S)"
    echo "warning: working tree has uncommitted changes, deploying as $TAG" >&2
  fi
else
  # CI builds only committed, pushed code; the tag is the first 12 chars of the SHA,
  # matching .github/workflows/build-images.yml.
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "error: --ci deploys pushed commits only; commit or stash your changes first" >&2
    exit 1
  fi
  git fetch --quiet origin main
  TARGET_SHA="$(git rev-parse origin/main)"
  if [[ "$(git rev-parse HEAD)" != "$TARGET_SHA" ]]; then
    echo "warning: --ci deploys origin/main, not your local HEAD" >&2
  fi

  # The workflow builds only commits that touch image inputs (its `paths` filter), so a
  # docs-only tip has no image: deploy the newest commit that does. `--first-parent` matches
  # what CI tagged, because a PR merge builds the merge commit, not the branch commit. Keep
  # this list in sync with `paths` in .github/workflows/build-images.yml.
  IMAGE_INPUTS=(apps packages package.json pnpm-lock.yaml pnpm-workspace.yaml .github/workflows/build-images.yml)
  BUILT_SHA="$(git log --first-parent -1 --format=%H "$TARGET_SHA" -- "${IMAGE_INPUTS[@]}")"
  if [[ -z "$BUILT_SHA" ]]; then
    echo "error: no image-producing commit found on origin/main" >&2
    exit 1
  fi
  TAG="${BUILT_SHA:0:12}"
  if [[ "$BUILT_SHA" != "$TARGET_SHA" ]]; then
    echo "note: origin/main ($(printf '%.12s' "$TARGET_SHA")) changes no image inputs; deploying the newest image commit ($TAG)" >&2
  fi

  # ghcr.io/<owner>/traccia-api and -web, where <owner> is parsed from the origin remote.
  ORIGIN="$(git remote get-url origin)"
  OWNER="$(printf '%s' "$ORIGIN" | sed -E 's#(git@|https?://)github\.com[:/]##; s#/.*##')"
  if [[ -z "$OWNER" ]]; then
    echo "error: could not parse the GitHub owner from origin ($ORIGIN)" >&2
    exit 1
  fi
  GHCR_PREFIX="${GHCR_PREFIX:-ghcr.io/$OWNER/traccia}"
fi

# An ssh config entry may set RemoteCommand and RequestTTY; both break scripted use.
SSH="ssh -o RemoteCommand=none -o RequestTTY=no $HOST"

step() {
  local title="$1" cmd="$2"
  echo "==> $title"
  echo "    $cmd"
  if [[ $DRY_RUN -eq 0 ]]; then eval "$cmd"; fi
}

[[ $DRY_RUN -eq 1 ]] && echo "(dry run: nothing below is executed)"
echo "tag: $TAG  host: $HOST  dir: $REMOTE_DIR  mode: $MODE"

# The pre-rename compose project is called `tracker`; starting `traccia` beside it would fight over the ports.
step "check the pre-rename stack is not running" \
  "[ -z \"\$($SSH 'docker ps -q --filter label=com.docker.compose.project=tracker')\" ] || { echo 'the old tracker compose project is still running on $HOST; stop it first (see the rename runbook in the PR / deploy/README.md)' >&2; exit 1; }"

# A fresh `traccia-data` volume would be empty: an install that predates the rename must name its old volume.
step "check the data volume is pinned on a pre-rename install" \
  "$SSH 'if docker volume inspect tracker_tracker-data >/dev/null 2>&1 && ! grep -q ^TRACCIA_DATA_VOLUME= $REMOTE_DIR/.env; then echo \"volume tracker_tracker-data exists but TRACCIA_DATA_VOLUME is not set in $REMOTE_DIR/.env; see deploy/README.md\" >&2; exit 1; fi'"

step "check the VPS is ready (.env present)" \
  "$SSH 'test -f $REMOTE_DIR/.env' || { echo 'missing $REMOTE_DIR/.env on $HOST (see deploy/.env.example)' >&2; exit 1; }"

if [[ "$MODE" == local ]]; then
  # Images are linux/amd64 and the Mac builds them natively (or under Docker Desktop's
  # emulation). On an aarch64 Linux host this fails in V8 under qemu; use --ci there.
  # --pull re-resolves node:22-slim, so a cached base image cannot ship an unpatched Node.
  for app in api web; do
    step "build traccia-$app (linux/amd64)" \
      "docker buildx build --pull --platform linux/amd64 --load -f apps/$app/Dockerfile -t traccia-$app:$TAG -t traccia-$app:latest ."
  done

  step "ship images" \
    "docker save traccia-api:$TAG traccia-web:$TAG traccia-api:latest traccia-web:latest | $SSH docker load"
else
  # The images are built by the workflow on main (in a matrix, so either may finish
  # first); wait for both rather than fail on a race.
  step "wait for the $TAG images in GHCR (CI may still be building)" \
    "$SSH 'for i in \$(seq 1 60); do if docker buildx imagetools inspect $GHCR_PREFIX-api:$TAG >/dev/null 2>&1 && docker buildx imagetools inspect $GHCR_PREFIX-web:$TAG >/dev/null 2>&1; then exit 0; fi; sleep 10; done; echo \"images for $TAG not found after 10 minutes; is the push to main green?\" >&2; exit 1'"

  # Pull and retag into the local names the compose file expects, so one compose
  # file serves both this mode and the build-on-Mac mode.
  step "pull images and retag" \
    "for app in api web; do $SSH \"docker pull $GHCR_PREFIX-\$app:$TAG && docker tag $GHCR_PREFIX-\$app:$TAG traccia-\$app:$TAG && docker tag $GHCR_PREFIX-\$app:$TAG traccia-\$app:latest\"; done"
fi

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
