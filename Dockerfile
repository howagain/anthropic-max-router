# Anthropic MAX Router Docker Image
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Default port (can be overridden)
ENV ROUTER_PORT=3000

# Expose the port
EXPOSE ${ROUTER_PORT}

# Create volume mount point for OAuth tokens
# Tokens will persist in /app/.oauth-tokens.json
VOLUME ["/app"]

# Run the router
# Note: For initial OAuth setup, run interactively with -it flag
CMD ["node", "dist/router/server.js"]
