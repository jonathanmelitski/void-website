FROM node:20-alpine
WORKDIR /app

# Install only WS server deps — baked into the image layer
COPY package.ws.json package.json
RUN npm install

# Source files
COPY tsconfig.json .
COPY server.ts .
COPY lib/aws/dynamo.ts lib/aws/
COPY lib/aws/games.ts lib/aws/
COPY lib/aws/points.ts lib/aws/
COPY lib/aws/point-events.ts lib/aws/
COPY lib/aws/players.ts lib/aws/

EXPOSE 3000
CMD ["npx", "tsx", "server.ts"]
