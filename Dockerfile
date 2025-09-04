# Dockerfile
FROM denoland/deno:alpine-1.37.0

# Set working directory
WORKDIR /app

# Copy source code
COPY . .

# Allow network access and run your server
CMD ["run", "--allow-net", "cheap_cache_server.ts"]
