FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN apk add --no-cache poppler-utils && npm ci
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
COPY scripts ./scripts
COPY seed ./seed
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
