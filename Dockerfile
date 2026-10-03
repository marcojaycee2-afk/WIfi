FROM node:24-alpine
WORKDIR /app
ENV HOST=0.0.0.0
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.html ./
COPY backend ./backend
EXPOSE 3000
CMD ["npm", "start"]