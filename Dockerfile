FROM node:20-alpine

WORKDIR /app

# מעתיק קודם את package.json לניצול cache
COPY package.json ./

# מתקין רק production dependencies
RUN npm install

# מעתיק את שאר הקבצים
COPY addon.js one-piece-links.json ./

EXPOSE 7000

CMD ["node", "addon.js"]
