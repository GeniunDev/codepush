FROM node:20-alpine

WORKDIR /app

# Add bash and build tools just in case any npm dependencies need compiling
RUN apk add --no-cache python3 make g++ bash

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# Port matching default server port
EXPOSE 3000

# Run the app
CMD ["npm", "run", "start:env"]
