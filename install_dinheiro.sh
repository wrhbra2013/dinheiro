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
MODERATOR_USER="moderador"
MODERATOR_PASS=$(openssl rand -hex 3 | cut -c1-4)
cat > "$INSTALL_DIR/.env" <<ENVEOF
PORT=$APP_PORT
DB_HOST=db
DB_PORT=5432
DB_NAME=${PNAME}
DB_USER=postgres
DB_PASS=wander
API_TOKEN=${API_TOKEN}
MODERATOR_USER=${MODERATOR_USER}
MODERATOR_PASS=${MODERATOR_PASS}
#WHATSAPP_API_URL=http://whatsapp:8080/message/send
COMPOSE_PROJECT_NAME=${PNAME}
ENVEOF
chmod 600 "$INSTALL_DIR/.env"


# ---------------------------------------------------------------
# package.json
# ---------------------------------------------------------------
cat > "$INSTALL_DIR/package.json" <<'JSONEOF'
{
  "name": "api-clubeinvestidores",
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

async function query(sql, params) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

// ====== Endpoints públicos (sem token) ======

app.get('/api-key', (_, res) => {
  res.json({ token: API_TOKEN });
});

app.get('/', (_, res) => res.json({ status: 'OK', project: 'InvestidoresClub' }));

app.get('/health', async (_, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', db: 'connected' });
  } catch { res.status(503).json({ status: 'unhealthy', db: 'disconnected' }); }
});

// ====== Middleware de autenticação (Bearer token obrigatório) ======

app.use((req, res, next) => {
  const publicPaths = ['/', '/health', '/api-key'];
  if (publicPaths.includes(req.path)) return next();
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ') || auth.slice(7) !== API_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// ====== Endpoints protegidos (exigem token) ======

app.post('/register', async (req, res) => {
  try {
    const { nome, usuario, celular } = req.body;
    if (!nome || !usuario || !celular) return res.status(400).json({ error: 'nome, usuario e celular obrigatórios' });
    const digito = celular.replace(/\D/g, '');
    const slug = usuario.replace(/[^a-z0-9._-]/g, '').toLowerCase().trim();
    if (!slug) return res.status(400).json({ error: 'Usuário inválido' });

    const schema = { nome: '', usuario: '', celular: '', senha: '', confirmCode: '', confirmed: '', createdAt: '', role: '' };
    await garantirTabela('usuarios', schema);
    await garantirColunas('usuarios', schema);

    const existente = await query('SELECT _id FROM "usuarios" WHERE celular=$1', [digito]);
    if (existente.length) return res.status(400).json({ error: 'Celular já cadastrado' });
    const existUser = await query('SELECT _id FROM "usuarios" WHERE usuario=$1', [slug]);
    if (existUser.length) return res.status(400).json({ error: 'Usuário já existe' });

    const confirmCode = String(Math.floor(100000 + Math.random() * 900000));
    const r = await query(
      `INSERT INTO "usuarios" (nome, usuario, celular, senha, "confirmCode", confirmed, "createdAt", role)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [nome.replace(/<[^>]*>/g, '').trim(), slug, digito, digito.slice(-4), confirmCode, 'false', new Date().toISOString(), 'user']
    );
    res.status(201).json({ user: r[0], code: confirmCode });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/confirm', async (req, res) => {
  try {
    const { celular, code } = req.body;
    const digito = celular.replace(/\D/g, '');
    await garantirTabela('usuarios', { nome: '', usuario: '', celular: '', senha: '', confirmCode: '', confirmed: '', createdAt: '', role: '' });
    const rows = await query('SELECT * FROM "usuarios" WHERE celular=$1', [digito]);
    if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });
    const u = rows[0];
    if (u.confirmed === 'true') return res.status(400).json({ error: 'Usuário já confirmado' });
    if (u.confirmcode !== code.trim()) return res.status(400).json({ error: 'Código inválido' });
    await query('UPDATE "usuarios" SET confirmed=$1 WHERE _id=$2', ['true', u._id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/login', async (req, res) => {
  try {
    const { usuario, senha } = req.body;
    const slug = (usuario || '').replace(/[^a-z0-9._-]/g, '').toLowerCase().trim();
    if (!slug) return res.status(400).json({ error: 'Usuário obrigatório' });
    await garantirTabela('usuarios', { nome: '', usuario: '', celular: '', senha: '', confirmCode: '', confirmed: '', createdAt: '', role: '' });
    const rows = await query('SELECT * FROM "usuarios" WHERE usuario=$1', [slug]);
    if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });
    const u = rows[0];
    if (u.confirmed !== 'true') return res.status(400).json({ error: 'Confirme seu WhatsApp primeiro' });
    if (u.senha !== senha) return res.status(401).json({ error: 'Senha incorreta' });
    res.json({ user: u });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/usuarios/me', async (req, res) => {
  try {
    const id = parseInt(req.query.id || req.headers['x-user-id'] || 0);
    if (!id) return res.status(400).json({ error: 'user id required' });
    await garantirTabela('usuarios', { nome: '', usuario: '', celular: '', senha: '', confirmCode: '', confirmed: '', createdAt: '', role: '' });
    const rows = await query('SELECT * FROM "usuarios" WHERE _id=$1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
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

// ====== Mensagens do Fórum ======

app.get('/mensagens/:asset', async (req, res) => {
  const asset = req.params.asset.replace(/[^a-z0-9_-]/g, '');
  if (!asset) return res.status(400).json({ error: 'invalid asset' });
  try {
    await garantirTabela('mensagens', { asset: '', userId: '', userName: '', message: '', createdAt: '' });
    const rows = await query(
      'SELECT * FROM "mensagens" WHERE asset=$1 ORDER BY _id DESC LIMIT 200', [asset]
    );
    res.json(rows);
  } catch { res.json([]); }
});

app.post('/mensagens', async (req, res) => {
  const { asset, userId, userName, message } = req.body;
  if (!asset || !userId || !message) return res.status(400).json({ error: 'asset, userId, message obrigatórios' });
  try {
    await garantirTabela('mensagens', { asset: '', userId: '', userName: '', message: '', createdAt: '' });
    await garantirColunas('mensagens', { asset: '', userId: '', userName: '', message: '', createdAt: '' });
    const safeMsg = message.replace(/<[^>]*>/g, '').trim();
    const rows = await query(
      `INSERT INTO "mensagens" (asset, "userId", "userName", message, "createdAt")
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [asset, String(userId), userName, safeMsg, new Date().toISOString()]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ====== Fóruns dinâmicos ======

const FORUM_SCHEMA = { nome: '', icone: '', descricao: '', categoria: '', createdAt: '' };

app.get('/foruns', async (_, res) => {
  try {
    await garantirTabela('foruns', FORUM_SCHEMA);
    await garantirColunas('foruns', FORUM_SCHEMA);
    const rows = await query('SELECT * FROM "foruns" ORDER BY _id ASC');
    res.json(rows);
  } catch { res.json([]); }
});

app.post('/foruns', async (req, res) => {
  try {
    const { nome, icone, descricao, categoria } = req.body;
    if (!nome) return res.status(400).json({ error: 'nome é obrigatório' });
    await garantirTabela('foruns', FORUM_SCHEMA);
    await garantirColunas('foruns', FORUM_SCHEMA);
    const r = await query(
      `INSERT INTO "foruns" (nome, icone, descricao, categoria, "createdAt")
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [nome.trim(), (icone || '📁'), (descricao || ''), (categoria || 'Personalizado'), new Date().toISOString()]
    );
    res.status(201).json(r[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/foruns/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'id inválido' });
    await pool.query('DELETE FROM "foruns" WHERE _id=$1', [id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ====== Deletar mensagem ======

app.delete('/mensagens/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'id inválido' });
    await pool.query('DELETE FROM "mensagens" WHERE _id=$1', [id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ====== WhatsApp ======

app.post('/whatsapp/send', async (req, res) => {
  try {
    const { celular, mensagem } = req.body;
    if (!celular || !mensagem) return res.status(400).json({ error: 'celular e mensagem obrigatórios' });
    const num = celular.replace(/\D/g, '');
    const waApi = process.env.WHATSAPP_API_URL;
    if (waApi) {
      const r = await fetch(waApi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: num, text: mensagem })
      });
      return res.json(await r.json());
    }
    console.log(`[WHATSAPP] ${num}: ${mensagem}`);
    res.json({ success: true, waLink: `https://wa.me/55${num}?text=${encodeURIComponent(mensagem)}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ====== CORS proxy para Yahoo Finance ======

app.get('/proxy/yahoo/chart/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.replace(/[^a-zA-Z0-9^.]/g, '');
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1d&interval=1d`;
    const r = await fetch(url);
    const data = await r.json();
    res.json(data);
  } catch (err) { res.status(502).json({ error: err.message }); }
});

app.get('/proxy/bcb/:serie', async (req, res) => {
  try {
    const serie = req.params.serie.replace(/[^0-9]/g, '');
    const r = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados/ultimos/1`);
    const data = await r.json();
    res.json(data);
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ====== Seed do moderador ======

async function seedModerator() {
  try {
    await garantirColunas('usuarios', { role: '' });
    const user = process.env.MODERATOR_USER || 'moderador';
    const pass = process.env.MODERATOR_PASS || '0000';
    const rows = await query('SELECT _id FROM "usuarios" WHERE usuario=$1', [user]);
    if (!rows.length) {
      await query(
        `INSERT INTO "usuarios" (nome, usuario, celular, senha, "confirmCode", confirmed, "createdAt", role)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        ['Moderador', user, '00000000000', pass, '', 'true', new Date().toISOString(), 'moderator']
      );
      console.log(`✓ Moderador criado (${user} / ${pass})`);
    } else {
      console.log(`✓ Moderador já existe (${user})`);
    }
  } catch (err) { console.error('Seed moderator:', err.message); }
}

seedModerator().then(() => app.listen(PORT, () => console.log(`Clube Investidores API :${PORT}`)));
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

# Test register
R=$(curl -sf -X POST "${BASE}register" -H "Content-Type: application/json" -d '{"nome":"Teste","celular":"11999999999"}' 2>/dev/null) || R=""
CODE=$(echo "$R" | sed -n 's/.*"code":"\([0-9]*\)".*/\1/p')
if [ -n "$CODE" ]; then
  info "POST /register OK (code=$CODE)"
  # Test confirm
  R2=$(curl -sf -X POST "${BASE}confirm" -H "Content-Type: application/json" -d "{\"celular\":\"11999999999\",\"code\":\"$CODE\"}" 2>/dev/null) || R2=""
  echo "$R2" | grep -q '"success"' && info "POST /confirm OK" || warn "POST /confirm falhou: $R2"
  # Test login
  R3=$(curl -sf -X POST "${BASE}login" -H "Content-Type: application/json" -d '{"celular":"11999999999","senha":"9999"}' 2>/dev/null) || R3=""
  UID=$(echo "$R3" | sed -n 's/.*"_id":\([0-9]*\).*/\1/p')
  [ -n "$UID" ] && info "POST /login OK (_id=$UID)" || warn "POST /login falhou: $R3"

  AUTH="Authorization: Bearer $API_TOKEN"
  DATA="{\"asset\":\"geral\",\"userId\":\"$UID\",\"userName\":\"Teste\",\"message\":\"Teste forum\"}"
  R4=$(curl -sf -X POST "${BASE}mensagens" -H "$AUTH" -H "Content-Type: application/json" -d "$DATA" 2>/dev/null) || R4=""
  echo "$R4" | grep -q '"message"' && info "POST /mensagens OK" || warn "POST /mensagens falhou: $R4"

  curl -sf "${BASE}mensagens/geral" -H "$AUTH" | grep -q "$UID" && info "GET /mensagens/geral OK" || warn "GET /mensagens/geral falhou"
else
  warn "POST /register falhou: $R"
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
echo "  Token:         $API_TOKEN"
echo "  Moderador:     $MODERATOR_USER / $MODERATOR_PASS"
echo ""
echo "  Configuração de autodescoberta do frontend..."
cat > "$INSTALL_DIR/../js/config.js" <<CONFIGEOF
// Gerado automaticamente pela instalação
// O token é descoberto automaticamente via GET /api-key
window.API_CONFIG = {
    baseUrl: 'https://api.projetosdinamicos.com.br/$PNAME/api'
};
CONFIGEOF
echo "  ✓ js/config.js gerado (token será descoberto automaticamente)"
echo ""
echo "  Para desinstalar: sudo bash $0 uninstall $INSTALL_DIR"
echo ""
