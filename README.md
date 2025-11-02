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

### Container lokal bauen

```bash
docker build -t ollama-chat-console:latest .
```

Optional kannst du das Image direkt für eine Registry taggen, z. B.:

```bash
docker tag ollama-chat-console:latest registry.example.com/mein-namespace/ollama-chat-console:latest
docker push registry.example.com/mein-namespace/ollama-chat-console:latest
```

### Lokaler Testlauf

```bash
docker run --rm -p 4173:4173 --name ollama-chat-console ollama-chat-console:latest
```

Die App liegt anschließend unter `http://localhost:4173`.

## Deployment via Docker Compose

Auf dem Zielsystem (z. B. Server) eine `docker-compose.yml` anlegen:

```yaml
services:
  ollama-chat-console:
    image: registry.example.com/mein-namespace/ollama-chat-console:latest
    ports:
      - "4173:4173"
    environment:
      NODE_ENV: production
      HOST: 0.0.0.0
      PORT: 4173
```

Vor dem Start ggf. bei der Registry anmelden:

```bash
docker login registry.example.com
```

Dann das Deployment hochziehen:

```bash
docker compose up -d
```

Die Weboberfläche ist anschließend unter `http://<server>:4173` erreichbar.

### Git-Repository auf Zielsystem deployen

Wenn dein Zielserver Zugriff auf dieses Git-Repository hat, kannst du den Code direkt dort klonen und per Compose ausrollen:

```bash
git clone https://github.com/<dein-user>/<dein-repo>.git
cd <dein-repo>
docker compose up -d
```

*Hinweis:* Passe die Repository-URL an (HTTPS oder SSH). Falls du nicht das veröffentlichte Image verwendest, sondern lokal builden möchtest, füge im Compose-File den `build:`-Abschnitt wieder ein (`build: { context: . }`) und starte dann `docker compose up --build -d`.

## Konfiguration via Environment Variablen

| Variable         | Beschreibung                                                                                      | Standardwert              |
|------------------|---------------------------------------------------------------------------------------------------|---------------------------|
| `DEFAULT_SERVER` | Basis-URL des Ollama-Backends, mit dem sich die Webapp verbindet (z. B. `http://localhost:11434`) | `http://localhost:11434`  |
| `HOST`           | Bind-Adresse des Node-Minimalservers                                                              | `0.0.0.0`                 |
| `PORT`           | Port des Node-Minimalservers                                                                      | `4173`                    |
| `NODE_ENV`       | Steuert Caching-Header (`production` aktiviert 1h Cache)                                          | `development`             |

`DEFAULT_SERVER` definiert den Standard-Endpunkt, an den der Node-Server die Proxy-Route `/ollama` weiterleitet. Der Browser erfragt diesen Wert zur Initialisierung über `/api/default-server`. Beispielsweise:

```bash
DEFAULT_SERVER=http://mein-ollama:11434 npm start
```

Im Docker/Compose-Setup kann die Variable wie gewohnt gesetzt werden (`docker run … -e DEFAULT_SERVER=…` bzw. im Compose-File unter `environment`). Die übrigen Variablen greifen nur den Node-Server selbst; für reine Nutzung hinter einem Reverse-Proxy reicht in der Regel das Anpassen von `DEFAULT_SERVER`.
