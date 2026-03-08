# AWS Lambda adapter (handles the Lambda runtime protocol)
FROM public.ecr.aws/awsguru/aws-lambda-adapter:0.9.0 AS aws-lambda-adapter

# Bun runtime base
FROM oven/bun:debian AS runtime

# Copy the Lambda adapter extension
COPY --from=aws-lambda-adapter /lambda-adapter /opt/extensions/lambda-adapter

# Lambda adapter expects the app to listen on PORT (default 8080)
ENV PORT=8080

WORKDIR /var/task

# Install production deps first (layer cache)
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

# Copy application source
COPY src/ ./src/

CMD ["bun", "src/index.ts"]
