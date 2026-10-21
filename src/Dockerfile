# AVefi Importer — Nuxt-4-Anwendung.
#
# Zwei Betriebsarten:
#   Entwicklung  npm run dev     Code gemountet, Aenderungen sofort wirksam
#   Auslieferung npm run build   erzeugt .output, Start mit npm start
#
# Der Vertrag verlangt, dass die Anwendung gebaut, gestartet und getestet werden
# kann — deshalb ist der Build-Pfad hier enthalten, auch wenn der Testserver im
# Entwicklungsmodus laeuft.

FROM node:24-alpine AS base
WORKDIR /app
RUN apk update && apk add --no-cache tini curl && rm -rf /var/cache/apk/*
ENV NODE_ENV=development
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts && npm rebuild esbuild
COPY . .
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "run", "dev"]

# --- Auslieferungsstufe -------------------------------------------------------
FROM base AS build
ENV NODE_ENV=production
RUN npm run build

FROM node:24-alpine AS production
WORKDIR /app
RUN apk update && apk add --no-cache tini && rm -rf /var/cache/apk/*
ENV NODE_ENV=production
COPY --from=build /app/.output /app/.output
# Die Oberflaechenbeschreibungen werden zur Laufzeit von der Platte gelesen
# (/dokumentation/oberflaeche). Ohne sie bliebe die Seite leer.
COPY --from=build /app/docs/oberflaeche /app/docs/oberflaeche
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", ".output/server/index.mjs"]
