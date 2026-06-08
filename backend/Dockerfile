# Build Stage
FROM node:20-slim AS builder

RUN apt-get update -y && apt-get install -y openssl

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Generate Prisma Client
RUN npx prisma generate

# Copy source code
COPY tsconfig.json ./
COPY src ./src/

# Build TypeScript
RUN npm run build

# Production Stage
FROM node:20-slim

RUN apt-get update -y && apt-get install -y openssl

WORKDIR /app

# Copy package files and install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy Prisma schema and generated client
COPY --from=builder /app/prisma ./prisma/
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client/
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma/

# Copy compiled code
COPY --from=builder /app/dist ./dist/

# Expose port
EXPOSE 8080

# Start server
CMD ["npm", "start"]
