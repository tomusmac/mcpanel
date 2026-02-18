FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000
EXPOSE 25565

CMD ["node", "src/server.js"]
