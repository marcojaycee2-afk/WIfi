FROM node:24-alpine
WORKDIR /app
ENV HOST=0.0.0.0
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.html ./
COPY login.html ./
COPY service-worker.js ./
COPY backend ./backend
EXPOSE 3000
CMD ["npm", "start"]