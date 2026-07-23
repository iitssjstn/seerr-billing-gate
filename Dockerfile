FROM node:20-alpine

# better-sqlite3 heeft build tools nodig om te compileren op alpine
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
VOLUME ["/app/data"]

EXPOSE 3000

CMD ["node", "src/server.js"]
