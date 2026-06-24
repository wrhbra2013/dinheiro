#!/bin/sh
set -eu

# ==============================================================
# Instalação — API FinanceOrganizer (Docker + PostgreSQL)
# Uso: sudo bash install_dinheiro.sh [uninstall]
# ==============================================================

SCRIPT_DIR="$(dirname "$0")"
NGINX_AVAILABLE="/etc/nginx/sites-available"
NGINX_ENABLED="/etc/nginx/sites-enabled"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { printf "${GREEN}[INFO]${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}[WARN]${NC} %s\n" "$1" >&2; }
error() { printf "${RED}[ERRO]${NC} %s\n" "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || error "Execute como root: sudo bash install_dinheiro.sh"


# ---------------------------------------------------------------
# uninstall
# ---------------------------------------------------------------
uninstall() {
  ENV_FILE="${INSTALL_DIR:-/var/www/dinheiro}/.env"
  [ -f "$ENV_FILE" ] && . "$ENV_FILE" || true

  INSTALL_DIR="${INSTALL_DIR:-/var/www/${COMPOSE_PROJECT_NAME:-dinheiro}}"
  PNAME="${COMPOSE_PROJECT_NAME:-dinheiro}"
  DB_NAME="${DB_NAME:-$PNAME}"

  _dc() { docker compose -f "$INSTALL_DIR/docker-compose.yml" "$@"; }

  if [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
    info "Removendo banco de dados $DB_NAME do PostgreSQL..."
    docker exec "${PNAME}-db-1" psql -U postgres -c "DROP DATABASE IF EXISTS \"${DB_NAME}\";" 2>/dev/null || \
      warn "Banco nao removido (container pode nao estar rodando)"

    info "Parando containers e removendo volumes..."
    _dc down -v 2>/dev/null && info "Containers e volumes removidos" || warn "Falha ao derrubar containers"
  fi

  info "Removendo nginx config..."
  if [ -f "$NGINX_AVAILABLE/default" ]; then
    sed -i "/${PNAME}-locations.conf/d" "$NGINX_AVAILABLE/default"
    nginx -t 2>/dev/null && sudo systemctl reload nginx 2>/dev/null || true
  fi
  rm -f "/etc/nginx/${PNAME}-locations.conf"

  info "Removendo $INSTALL_DIR..."
  rm -rf "$INSTALL_DIR" && info "Diretório removido"

  info "Desinstalação concluída"
  exit 0
}

case "${1:-}" in
  uninstall)
    INSTALL_DIR="${2:-/var/www/dinheiro}"
    uninstall
    ;;
esac


# ---------------------------------------------------------------
# Dependências
# ---------------------------------------------------------------
info "Verificando dependências..."

if ! command -v docker >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -y -qq docker.io
  systemctl enable --now docker
fi

DCC="docker compose"
docker compose version >/dev/null 2>&1 || DCC="docker-compose"

if ! command -v nginx >/dev/null 2>&1; then
  apt-get install -y -qq nginx
fi


# ---------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------
while :; do
  printf "Porta da API (host) [3001]: "; read -r APP_PORT
  APP_PORT=${APP_PORT:-3001}
  if command -v ss >/dev/null 2>&1; then
    if ss -tlnp "sport = :$APP_PORT" 2>/dev/null | grep -qv 'State.*Recv-Q'; then
      warn "Porta $APP_PORT em uso"; continue
    fi
  fi
  break
done

printf "Nome do projeto [dinheiro]: "; read -r PNAME
PNAME=${PNAME:-dinheiro}

INSTALL_DIR="/var/www/$PNAME"
SRC_DIR="$INSTALL_DIR/src"

echo "  Porta: $APP_PORT"
echo "  Projeto: $PNAME"
echo "  Instalar em: $INSTALL_DIR"


# ---------------------------------------------------------------
# Diretórios
# ---------------------------------------------------------------
mkdir -p "$SRC_DIR"


# ---------------------------------------------------------------
# .env
# ---------------------------------------------------------------
API_TOKEN=$(openssl rand -hex 32)
cat > "$INSTALL_DIR/.env" <<ENVEOF
PORT=$APP_PORT
DB_HOST=db
DB_PORT=5432
DB_NAME=${PNAME}
DB_USER=postgres
DB_PASS=wander
API_TOKEN=${API_TOKEN}
COMPOSE_PROJECT_NAME=${PNAME}
ENVEOF
chmod 600 "$INSTALL_DIR/.env"


# ---------------------------------------------------------------
# package.json
# ---------------------------------------------------------------
cat > "$INSTALL_DIR/package.json" <<'JSONEOF'
{
  "name": "api-financeorganizer",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "node src/server.js"
  },
  "dependencies": {
    "express": "^4.21.0",
    "pg": "^8.12.0"
  }
}
JSONEOF


# ---------------------------------------------------------------
# src/server.js  —  API auto-create tables
# ---------------------------------------------------------------
cat > "$SRC_DIR/server.js" <<'SRVEOF'
const { Pool } = require('pg');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
});

pool.on('error', (err) => console.error('DB error:', err.message));

app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const API_TOKEN = process.env.API_TOKEN || '';

app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/health') return next();
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ') || auth.slice(7) !== API_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

async function tabelaExiste(tabela) {
  const { rows } = await pool.query(
    "SELECT EXISTS (SELECT FROM pg_tables WHERE schemaname='public' AND tablename=$1)", [tabela]
  );
  return rows[0].exists;
}

async function garantirColunas(tabela, data) {
  const chaves = Object.keys(data).filter(k => !['id', '_id', 'table', 'project'].includes(k));
  if (!chaves.length) return;
  const { rows } = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name=$1", [tabela]
  );
  const existentes = new Set(rows.map(r => r.column_name));
  for (const col of chaves) {
    if (!existentes.has(col)) {
      await pool.query(`ALTER TABLE "${tabela}" ADD COLUMN "${col}" TEXT`);
      console.log(`Coluna "${col}" criada em "${tabela}"`);
    }
  }
}

async function garantirTabela(tabela, data) {
  if (await tabelaExiste(tabela)) return;
  const cols = Object.keys(data)
    .filter(k => !['id', '_id', 'table', 'project'].includes(k))
    .map(k => `"${k}" TEXT`);
  if (!cols.length) return;
  await pool.query(`CREATE TABLE "${tabela}" (_id SERIAL PRIMARY KEY, ${cols.join(', ')})`);
  console.log(`Tabela "${tabela}" criada`);
}

app.get('/', (_, res) => res.json({ status: 'OK', project: 'FinanceOrganizer' }));

app.get('/health', async (_, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', db: 'connected' });
  } catch { res.status(503).json({ status: 'unhealthy', db: 'disconnected' }); }
});

app.get('/:tabela', async (req, res) => {
  const t = req.params.tabela.replace(/[^a-z0-9_]/g, '');
  if (!t) return res.status(400).json({ error: 'invalid table' });
  try {
    const { rows } = await pool.query(`SELECT * FROM "${t}" ORDER BY _id DESC LIMIT 500`);
    res.json(rows);
  } catch { res.json([]); }
});

app.post('/:tabela', async (req, res) => {
  const t = req.params.tabela.replace(/[^a-z0-9_]/g, '');
  if (!t) return res.status(400).json({ error: 'invalid table' });
  const data = { ...req.body };
  delete data.table; delete data.project;
  const keys = Object.keys(data);
  if (!keys.length) return res.status(400).json({ error: 'empty body' });
  try {
    await garantirTabela(t, data);
    await garantirColunas(t, data);
    const cols = keys.map(k => `"${k}"`);
    const vals = keys.map((_, i) => `$${i + 1}`);
    const { rows } = await pool.query(
      `INSERT INTO "${t}" (${cols}) VALUES (${vals}) RETURNING *`, keys.map(k => data[k])
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/:tabela/:id', async (req, res) => {
  const t = req.params.tabela.replace(/[^a-z0-9_]/g, '');
  const id = parseInt(req.params.id);
  if (!t) return res.status(400).json({ error: 'invalid table' });
  if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
  const data = { ...req.body };
  delete data.table; delete data.project; delete data.id; delete data._id;
  const keys = Object.keys(data);
  if (!keys.length) return res.status(400).json({ error: 'empty body' });
  try {
    await garantirColunas(t, data);
    const sets = keys.map((k, i) => `"${k}" = $${i + 1}`);
    const { rows } = await pool.query(
      `UPDATE "${t}" SET ${sets} WHERE _id = $${keys.length + 1} RETURNING *`,
      [...keys.map(k => data[k]), id]
    );
    res.json(rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/:tabela/:id', async (req, res) => {
  const t = req.params.tabela.replace(/[^a-z0-9_]/g, '');
  const id = parseInt(req.params.id);
  if (!t) return res.status(400).json({ error: 'invalid table' });
  if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    await pool.query(`DELETE FROM "${t}" WHERE _id = $1`, [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`FinanceOrganizer API :${PORT}`));
SRVEOF


# ---------------------------------------------------------------
# Dockerfile
# ---------------------------------------------------------------
cat > "$INSTALL_DIR/Dockerfile" <<'DOCKEREOF'
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY src/ ./src/
EXPOSE 3000
CMD ["node", "src/server.js"]
DOCKEREOF


# ---------------------------------------------------------------
# docker-compose.yml
# ---------------------------------------------------------------
cat > "$INSTALL_DIR/docker-compose.yml" <<'COMPOSEEOF'
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${DB_NAME}
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASS}
    volumes:
      - pgdata:/var/lib/postgresql/data
    networks:
      - app-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d ${DB_NAME}"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 30s

  api:
    build: .
    ports:
      - "127.0.0.1:${PORT}:${PORT}"
    environment:
      PORT: ${PORT}
      DB_HOST: db
      DB_PORT: 5432
      DB_NAME: ${DB_NAME}
      DB_USER: ${DB_USER}
      DB_PASS: ${DB_PASS}
      API_TOKEN: ${API_TOKEN}
    depends_on:
      db:
        condition: service_healthy
    networks:
      - app-network
    restart: unless-stopped

networks:
  app-network:
    driver: bridge

volumes:
  pgdata:
COMPOSEEOF


# ---------------------------------------------------------------
# Nginx config
# ---------------------------------------------------------------
info "Configurando nginx..."

# Cria arquivo de configuracao separado para os locations do dinheiro
DINHEIRO_NGINX_CONF="/etc/nginx/${PNAME}-locations.conf"

cat > "$DINHEIRO_NGINX_CONF" <<NGINXEOF
location /${PNAME}/api/ {
    rewrite ^/${PNAME}/api/(.*) /\$1 break;
    proxy_pass http://127.0.0.1:${APP_PORT}/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
}

location /${PNAME}/health {
    rewrite ^/${PNAME}/health(.*) /health\$1 break;
    proxy_pass http://127.0.0.1:${APP_PORT};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
}
NGINXEOF

# Adiciona include nos server blocks do api.projetosdinamicos.com.br
if [ -f "$NGINX_AVAILABLE/default" ]; then
  if ! grep -q "${PNAME}-locations.conf" "$NGINX_AVAILABLE/default"; then
    sed -i "/^\s*server_name api\.projetosdinamicos\.com\.br;$/a\    include ${DINHEIRO_NGINX_CONF};" "$NGINX_AVAILABLE/default"
    info "Include adicionado ao nginx"
  else
    info "Include ja existe no nginx"
  fi
fi

nginx -t 2>/dev/null && sudo systemctl reload nginx 2>/dev/null && info "Nginx configurado" || \
  warn "Falha no nginx — verifique manualmente"


# ---------------------------------------------------------------
# Docker build + up
# ---------------------------------------------------------------
if [ -f "$INSTALL_DIR/docker-compose.yml" ] && [ -d "$SRC_DIR" ] && [ -f "$INSTALL_DIR/.env" ]; then
  info "Projeto já instalado — apenas subindo containers..."
  $DCC -f "$INSTALL_DIR/docker-compose.yml" --project-name "$PNAME" up -d || error "Falha ao subir containers"
  info "Logs dos containers:"
  $DCC -f "$INSTALL_DIR/docker-compose.yml" --project-name "$PNAME" logs --tail=20
  exit 0
fi

info "Build da imagem..."
$DCC -f "$INSTALL_DIR/docker-compose.yml" build || error "Falha no build"

info "Iniciando containers..."
$DCC -f "$INSTALL_DIR/docker-compose.yml" --project-name "$PNAME" up -d || error "Falha ao iniciar"

info "Logs dos containers:"
$DCC -f "$INSTALL_DIR/docker-compose.yml" --project-name "$PNAME" logs --tail=20

info "Aguardando API (até 30s)..."
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$APP_PORT/health" >/dev/null 2>&1; then
    info "API pronta (${i}s)"
    break
  fi
  [ "$i" -eq 30 ] && warn "API não respondeu — veja: $DCC logs api"
  sleep 1
done


# ---------------------------------------------------------------
# Testes
# ---------------------------------------------------------------
info "Testando via localhost..."
sleep 2
BASE="http://127.0.0.1:$APP_PORT/"
curl -sf "$BASE" | grep -q '"OK"' && info "GET /     OK" || warn "GET /     falhou"
curl -sf "${BASE}health" | grep -q '"healthy"' && info "GET /health OK" || warn "GET /health falhou"

AUTH="Authorization: Bearer $API_TOKEN"
DATA='{"descricao":"Teste install","valor":100,"categoria":"outros","data":"2026-06-21"}'
R=$(curl -sf -X POST "${BASE}receitas" -H "$AUTH" -H "Content-Type: application/json" -d "$DATA" 2>/dev/null) || R=""
ID=$(echo "$R" | sed -n 's/.*"_id":\([0-9]*\).*/\1/p')
if [ -n "$ID" ]; then
  info "POST   /receitas OK (_id=$ID)"
  curl -sf "${BASE}receitas" -H "$AUTH" | grep -q "$ID" && info "GET    /receitas OK" || warn "GET    /receitas falhou"
  curl -sf -X DELETE "${BASE}receitas/$ID" -H "$AUTH" | grep -q '"success"' && info "DELETE /receitas OK" || warn "DELETE /receitas falhou"
else
  warn "POST   /receitas falhou: $R"
fi

info "Testando via nginx (URL pública)..."
PUBLIC_API="https://api.projetosdinamicos.com.br/$PNAME/api/"
PUBLIC_HEALTH="https://api.projetosdinamicos.com.br/$PNAME/health"
curl -sfk "$PUBLIC_API" | grep -q '"OK"' && info "GET  $PUBLIC_API OK" || warn "GET  $PUBLIC_API falhou"
curl -sfk "$PUBLIC_HEALTH" | grep -q '"healthy"' && info "GET  $PUBLIC_HEALTH OK" || warn "GET  $PUBLIC_HEALTH falhou"


# ---------------------------------------------------------------
echo ""
info "===== Instalação concluída ====="
echo ""
echo "  API:       http://api.projetosdinamicos.com.br/$PNAME/api/"
echo "  Health:    http://api.projetosdinamicos.com.br/$PNAME/health"
echo "  Porta:     $APP_PORT"
echo "  Diretório: $INSTALL_DIR"
echo ""
echo "  Token:     $API_TOKEN"
echo ""
echo "  No Servidor B (frontend estático), configure:"
echo "    URL da API: https://api.projetosdinamicos.com.br/$PNAME/api"
echo "    Token:      $API_TOKEN"
echo "    Projeto:    $PNAME"
echo ""
echo "  Para desinstalar: sudo bash $0 uninstall $INSTALL_DIR"
echo ""
