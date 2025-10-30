# Ollama Chat Console

Single-Page-Application, um mit einem Ollama-Server zu chatten. Chats, Modelleinstellungen und Parameter werden dauerhaft im Browser gespeichert.

## Voraussetzungen

- Node.js ≥ 20 (für den lokalen Start)
- Docker (optional, zum Container-Build)

## Lokaler Start (ohne Docker)

```bash
npm install
npm start
```

Der Server läuft anschließend unter `http://localhost:4173`.

## Docker

### Image bauen

```bash
docker build -t ollama-chat-console .
```

### Container starten

```bash
docker run --rm -p 4173:4173 --name ollama-chat-console ollama-chat-console
```

Der Container exponiert Port `4173`. Anschließend ist die App unter `http://localhost:4173` erreichbar.

## Docker Compose Beispiel

```yaml
services:
  ollama-chat-console:
    image: ollama-chat-console:latest
    build:
      context: .
    ports:
      - "4173:4173"
    environment:
      NODE_ENV: production
      HOST: 0.0.0.0
      PORT: 4173
```

Nach dem Start mit `docker compose up --build` steht die Weboberfläche im Browser unter `http://localhost:4173`.

