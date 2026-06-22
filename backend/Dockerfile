FROM node:20-alpine

WORKDIR /app

# Dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Source
COPY src ./src

EXPOSE 4000

CMD ["node", "src/index.js"]
