FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/worker/package.json apps/worker/
RUN npm ci --workspace=packages/shared --workspace=apps/worker
COPY packages/shared packages/shared
COPY apps/worker apps/worker
RUN npm run build -w packages/shared && npm run build -w apps/worker

FROM node:22-alpine
RUN apk add --no-cache git
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/apps/worker/package.json apps/worker/
RUN npm ci --workspace=packages/shared --workspace=apps/worker --omit=dev
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/worker/dist apps/worker/dist
CMD ["node", "apps/worker/dist/index.js"]
