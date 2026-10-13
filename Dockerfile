FROM node:22-slim AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml .npmrc ./
RUN npm exec --yes --package=pnpm@9.12.0 -- pnpm install --frozen-lockfile

COPY . .
RUN npm exec --yes --package=pnpm@9.12.0 -- pnpm build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist/index.js ./dist/index.js
COPY --from=build /app/dist/web ./dist/web

EXPOSE 3000
CMD ["node", "dist/index.js"]
