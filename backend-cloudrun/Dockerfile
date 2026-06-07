FROM node:22-alpine

WORKDIR /app

# Instalar dependencias
COPY package*.json ./
RUN npm install --production

# Copiar el código del backend
COPY . .

# Exponer el puerto configurado (Cloud Run inyecta la variable PORT, que por defecto es 8080)
EXPOSE 8080

CMD ["node", "server.js"]
