FROM node:16-bullseye-slim
COPY package-lock.json package.json ./
COPY dist ./dist
RUN npm install
CMD node ./dist/cli.js