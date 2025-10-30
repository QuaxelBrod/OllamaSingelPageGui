FROM node:20-alpine AS runtime

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=4173 HOST=0.0.0.0 NODE_ENV=production
EXPOSE 4173

CMD ["node", "server.js"]

