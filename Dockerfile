FROM node:16-bullseye-slim

WORKDIR /stripe-mock

COPY --from=project package-lock.json package.json ./
COPY --from=project dist .
RUN npm install
CMD node ./cli.js