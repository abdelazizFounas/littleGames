#!/bin/sh
# Deploys a commit to the production server.
#
#   tools/scripts/deploy.sh            # deploys the current branch's HEAD
#   tools/scripts/deploy.sh main       # deploys a named ref
#
# The server pulls from the repository rather than being rsynced from a working
# tree: what runs in production is then always a commit that exists, that can be
# named, and that somebody can check out and reproduce. A deploy from a dirty
# working tree is a deploy of something that is nowhere.
#
# Requires an ssh alias reaching the server as a user in the docker group, and
# a populated .env already on it — secrets are never sent from here.
set -eu

HOST="${DEPLOY_HOST:-vps2}"
ROOT="${DEPLOY_ROOT:-/opt/littlegames}"
REF="${1:-$(git rev-parse --abbrev-ref HEAD)}"

echo "==> pushing $REF"
git push origin "$REF"

COMMIT="$(git rev-parse "$REF")"
echo "==> deploying $COMMIT to $HOST:$ROOT"

# shellcheck disable=SC2087  # the heredoc is expanded here on purpose, so the
# ref and the paths above reach the remote shell.
ssh "$HOST" /bin/sh -eu <<EOF
cd "$ROOT"
git fetch --quiet origin
git checkout --quiet --detach "$COMMIT"
echo "--> now at \$(git log --oneline -1)"

cd server/docker
docker compose --env-file "$ROOT/.env" \
  -f docker-compose.yml -f docker-compose.prod.yml \
  up -d --build

echo "--> waiting for the stack to report healthy"
for attempt in \$(seq 1 60); do
  state=\$(docker inspect --format '{{.State.Health.Status}}' littlegames-nakama-1 2>/dev/null || echo starting)
  [ "\$state" = healthy ] && break
  sleep 2
done
docker compose --env-file "$ROOT/.env" \
  -f docker-compose.yml -f docker-compose.prod.yml ps
EOF

echo "==> deployed"
