# Dockerfile
FROM denoland/deno:alpine-1.37.0

# This directory will be created automatically in the container
WORKDIR /app

# Copy your source code from your repo into the container
COPY . .

# Cache dependencies
RUN deno cache cheap_cache_server.ts

# Expose the port your server listens on
EXPOSE 8080

# Run your server, allowing the network access and run your server
CMD ["run", "--allow-net", "--allow-read", "--allow-write", "cheap_cache_server.ts"]
