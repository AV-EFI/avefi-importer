# AVefi Importer — Nuxt-4-Anwendung.
#
# Vier Stufen:
#   base        Entwicklung und Tests. Alle Abhaengigkeiten, Quellen, `nuxt
#               prepare`. docker-compose.dev.yml haengt den Code darueber ein.
#   build       erzeugt .output (npm run build)
#   production  Weboberflaeche: nur .output, Start mit node .output/server/index.mjs
#   worker      Hintergrundprozess: Laufzeitabhaengigkeiten, Serverquellen,
#               Start mit npm run worker
#
# `production` und `worker` starten jeweils von selbst das Richtige. Eine
# Pipeline muss keinen Startbefehl setzen.
#
#   docker build --target production -t avefi-importer:web .
#   docker build --target worker     -t avefi-importer:worker .

FROM node:24-alpine AS base
WORKDIR /app
# `test -x`: Lieber scheitert der Bau als spaeter der Containerstart. In einem
# Kaniko-Bau fehlte /sbin/tini im fertigen Abbild, ohne dass der Bau es meldete.
RUN apk update && apk add --no-cache tini curl && rm -rf /var/cache/apk/* && test -x /sbin/tini
ENV NODE_ENV=development
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts && npm rebuild esbuild
COPY . .
# Erzeugt .nuxt/tsconfig.json. Davon erben tsconfig.json, die Tests (vite liest
# die tsconfig) und der Worker (`#shared/*` wird darueber aufgeloest). Ohne
# diesen Schritt scheitern alle Testdateien, und der Worker startet nicht.
RUN npx nuxt prepare
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "run", "dev"]

# --- Auslieferung -------------------------------------------------------------
FROM base AS build
ENV NODE_ENV=production
RUN npm run build

FROM node:24-alpine AS production
WORKDIR /app
RUN apk update && apk add --no-cache tini && rm -rf /var/cache/apk/* && test -x /sbin/tini
ENV NODE_ENV=production
COPY --from=build /app/.output /app/.output
# Die Oberflaechenbeschreibungen werden zur Laufzeit von der Platte gelesen
# (/dokumentation/oberflaeche). Ohne sie bliebe die Seite leer.
COPY --from=build /app/docs/oberflaeche /app/docs/oberflaeche
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", ".output/server/index.mjs"]

# Der Worker laeuft nicht aus .output: Er ist ein eigenes Programm
# (server/worker/main.ts), das tsx zur Laufzeit uebersetzt. tsx steht deshalb
# unter `dependencies`. Mitgenommen wird nur, was er braucht: Serverquellen,
# gemeinsame Typen, das Schema (liest er beim Start von der Platte) und die
# tsconfig fuer `#shared/*`. Dieselbe Stufe kann `npm run seed` und
# `npm run migrate` ausfuehren.
FROM node:24-alpine AS worker
WORKDIR /app
RUN apk update && apk add --no-cache tini && rm -rf /var/cache/apk/* && test -x /sbin/tini
ENV NODE_ENV=production
# Keine Hoechstlaufzeit: Der Selbstneustart ist eine Vorkehrung fuer den
# Entwicklungsbetrieb mit eingehaengtem Code (siehe server/worker/laufzeit.ts).
ENV WORKER_MAX_UPTIME=0
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts && npm rebuild esbuild && npm cache clean --force
COPY --from=build /app/server /app/server
COPY --from=build /app/shared /app/shared
COPY --from=build /app/db /app/db
COPY --from=build /app/tsconfig.json /app/tsconfig.json
COPY --from=build /app/.nuxt/tsconfig.json /app/.nuxt/tsconfig.json
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "run", "worker"]
