#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# deploy-lambda.sh
#
# Builds a Docker image for the backend and deploys it to AWS ECR + Lambda.
# Environment variables are read from .env.production and synced to Lambda
# on every run (secrets are never baked into the image).
#
# Usage:
#   ./scripts/deploy-lambda.sh [options]
#
# Options:
#   --region        AWS region              (default: us-east-2)
#   --repo          ECR repository name     (default: didaas/smart-wallet-poc)
#   --function      Lambda function name    (default: didaas-smartwallet-backend)
#   --profile       AWS CLI profile         (default: dentsu-didaas)
#   --create        Create ECR repo and Lambda function if they don't exist
#   --help          Show this help message
#
# Prerequisites:
#   - AWS CLI configured (or environment variables AWS_ACCESS_KEY_ID, etc.)
#   - Docker running
#   - python3 installed (for .env.production parsing)
# ---------------------------------------------------------------------------
set -euo pipefail

# ── Defaults ────────────────────────────────────────────────────────────────
REGION="us-east-2"
REPO_NAME="didaas/smart-wallet-poc"
FUNCTION_NAME="didaas-smartwallet-backend"
AWS_PROFILE="dentsu-didaas"
CREATE_RESOURCES=false
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# ── Argument parsing ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --region)    REGION="$2";        shift 2 ;;
    --repo)      REPO_NAME="$2";     shift 2 ;;
    --function)  FUNCTION_NAME="$2"; shift 2 ;;
    --profile)   AWS_PROFILE="$2";   shift 2 ;;
    --create)    CREATE_RESOURCES=true; shift ;;
    --help)
      sed -n '2,30p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Parse .env.production → Lambda environment JSON ─────────────────────────
# Writes a temp file with {"Variables":{...}} and prints its path.
# PORT is excluded — the Dockerfile/Lambda adapter fixes it at 8080.
# Call: ENV_FILE=$(build_lambda_env_file); trap "rm -f $ENV_FILE" EXIT
build_lambda_env_file() {
  local env_file="${PROJECT_DIR}/.env.production"
  if [[ ! -f "$env_file" ]]; then
    echo "ERROR: .env.production not found at ${env_file}" >&2
    exit 1
  fi

  local tmp
  tmp=$(mktemp /tmp/lambda-env-production.json)

  python3 - "$env_file" "$tmp" <<'PYEOF'
import sys, json

env_file, out_file = sys.argv[1], sys.argv[2]
variables = {}

with open(env_file) as f:
    for line in f:
        line = line.rstrip("\n").strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip()
        # Strip surrounding quotes
        if len(val) >= 2 and val[0] == val[-1] and val[0] in ('"', "'"):
            val = val[1:-1]
        if key:
            variables[key] = val

with open(out_file, "w") as f:
    json.dump({"Variables": variables}, f)
PYEOF

  echo "$tmp"
}

# ── AWS CLI profile helper ───────────────────────────────────────────────────
aws_cmd() {
  if [[ -n "$AWS_PROFILE" ]]; then
    aws --profile "$AWS_PROFILE" "$@"
  else
    aws "$@"
  fi
}

# ── Step 1: Resolve AWS account ID ──────────────────────────────────────────
echo "==> Resolving AWS account ID..."
ACCOUNT_ID=$(aws_cmd sts get-caller-identity --query Account --output text)
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPO_NAME}"
echo "    Account : $ACCOUNT_ID"
echo "    Region  : $REGION"
echo "    ECR URI : $ECR_URI"

# ── Step 2: Create ECR repository (if --create) ──────────────────────────────
if $CREATE_RESOURCES; then
  echo "==> Creating ECR repository '$REPO_NAME' (if it doesn't exist)..."
  aws_cmd ecr create-repository \
    --repository-name "$REPO_NAME" \
    --region "$REGION" \
    --image-scanning-configuration scanOnPush=true \
    --output text 2>/dev/null || echo "    Repository already exists, skipping."
fi

# ── Step 3: Build Docker image ───────────────────────────────────────────────
IMAGE_TAG="${ECR_URI}:latest"
echo "==> Building Docker image for linux/amd64..."
docker build \
  --provenance=false \
  --platform linux/amd64 \
  -t "${REPO_NAME}:latest" \
  "$PROJECT_DIR"

# ── Step 4: Authenticate with ECR ────────────────────────────────────────────
echo "==> Authenticating Docker with ECR..."
aws_cmd ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

# ── Step 5: Tag & push ───────────────────────────────────────────────────────
echo "==> Tagging and pushing image to ECR..."
docker tag "${REPO_NAME}:latest" "$IMAGE_TAG"
docker push "$IMAGE_TAG"
echo "    Pushed: $IMAGE_TAG"

# ── Step 6: Parse .env.production into a temp JSON file ──────────────────────
echo "==> Reading credentials from .env.production..."
ENV_FILE=$(build_lambda_env_file)
trap 'rm -f "$ENV_FILE"' EXIT
echo "    Credentials loaded."

# ── Step 7: Create or update Lambda function ──────────────────────────────────
FUNCTION_EXISTS=$(aws_cmd lambda get-function \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --query 'Configuration.FunctionName' \
  --output text 2>/dev/null || echo "")

if [[ -z "$FUNCTION_EXISTS" ]]; then
  if ! $CREATE_RESOURCES; then
    echo ""
    echo "Lambda function '$FUNCTION_NAME' does not exist."
    echo "Re-run with --create to create it, or create it manually in the AWS Console:"
    echo "  AWS Console > Lambda > Create Function > Container image"
    echo "  Image URI: $IMAGE_TAG"
    echo ""
    exit 0
  fi

  # ── Create IAM execution role (skip if already exists) ────────────────────
  ROLE_NAME="${FUNCTION_NAME}-role"
  echo "==> Creating IAM execution role '$ROLE_NAME' (if it doesn't exist)..."
  TRUST_POLICY='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
  ROLE_ARN=$(aws_cmd iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "$TRUST_POLICY" \
    --query 'Role.Arn' --output text 2>/dev/null \
    || aws_cmd iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)
  echo "    Role ARN: $ROLE_ARN"

  aws_cmd iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole 2>/dev/null || true

  echo "    Waiting for IAM role to propagate..."
  sleep 10

  # ── Create Lambda function with credentials from .env.production ───────────
  echo "==> Creating Lambda function '$FUNCTION_NAME'..."
  aws_cmd lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --package-type Image \
    --code "ImageUri=${IMAGE_TAG}" \
    --role "$ROLE_ARN" \
    --region "$REGION" \
    --timeout 30 \
    --memory-size 512 \
    --architectures x86_64 \
    --environment "file://${ENV_FILE}" \
    2>/dev/null || echo "    Function already exists, skipping creation."

  # ── Create Function URL (skip if already exists) ───────────────────────────
  echo "==> Creating Function URL (public, no auth, if it doesn't exist)..."
  FUNCTION_URL=$(aws_cmd lambda create-function-url-config \
    --function-name "$FUNCTION_NAME" \
    --auth-type NONE \
    --region "$REGION" \
    --query 'FunctionUrl' --output text 2>/dev/null \
    || aws_cmd lambda get-function-url-config \
        --function-name "$FUNCTION_NAME" \
        --region "$REGION" \
        --query 'FunctionUrl' --output text 2>/dev/null \
    || echo "(could not retrieve function URL)")

  # Allow public invocations (skip if permission already exists)
  aws_cmd lambda add-permission \
    --function-name "$FUNCTION_NAME" \
    --statement-id AllowPublicAccess \
    --action lambda:InvokeFunctionUrl \
    --principal '*' \
    --function-url-auth-type NONE \
    --region "$REGION" 2>/dev/null || true

else
  # ── Update image ───────────────────────────────────────────────────────────
  echo "==> Updating existing Lambda function '$FUNCTION_NAME'..."
  aws_cmd lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --image-uri "$IMAGE_TAG" \
    --region "$REGION" \
    --architectures x86_64

  echo "==> Waiting for code update to complete..."
  aws_cmd lambda wait function-updated \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION"

  # ── Sync credentials from .env.production ─────────────────────────────────
  echo "==> Syncing credentials from .env.production..."
  aws_cmd lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION" \
    --environment "file://${ENV_FILE}"

  echo "==> Waiting for configuration update to complete..."
  aws_cmd lambda wait function-updated \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION"

  FUNCTION_URL=$(aws_cmd lambda get-function-url-config \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION" \
    --query 'FunctionUrl' --output text 2>/dev/null || echo "(no function URL configured)")
fi

echo ""
echo "✓ Deploy complete!"
echo "  Function URL: ${FUNCTION_URL:-(run again to retrieve)}"
