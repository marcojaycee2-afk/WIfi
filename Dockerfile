FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.html ./
COPY backend ./backend
EXPOSE 3000
CMD ["npm", "start"]