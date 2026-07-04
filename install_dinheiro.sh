#!/bin/sh
set -eu

# ==============================================================
# Instalação — API Dinheiro (Orçamento + Patrimônio Pessoal)
# Uso: sudo bash install_dinheiro.sh [uninstall]
# ==============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
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
# .env (preserva token/senha existentes)
# ---------------------------------------------------------------
if [ -f "$INSTALL_DIR/.env" ]; then
  . "$INSTALL_DIR/.env"
  info ".env existente preservado"
fi
API_TOKEN="${API_TOKEN:-$(openssl rand -hex 32)}"
MODERATOR_USER="${MODERATOR_USER:-admin}"
MODERATOR_PASS="${MODERATOR_PASS:-$(openssl rand -hex 3 | cut -c1-4)}"
cat > "$INSTALL_DIR/.env" <<ENVEOF
PORT=$APP_PORT
DB_HOST=db
DB_PORT=5432
DB_NAME=${PNAME}
DB_USER=postgres
DB_PASS=wander
API_TOKEN=${API_TOKEN}
ADMIN_USER=${MODERATOR_USER}
ADMIN_PASS=${MODERATOR_PASS}
COMPOSE_PROJECT_NAME=${PNAME}
ENVEOF
chmod 600 "$INSTALL_DIR/.env"


# ---------------------------------------------------------------
# package.json
# ---------------------------------------------------------------
cat > "$INSTALL_DIR/package.json" <<'JSONEOF'
{
  "name": "api-dinheiro",
  "version": "2.0.0",
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
# src/server.js  —  API de Orçamento e Patrimônio Pessoal
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

app.get('/', (_, res) => res.json({ status: 'OK', project: 'Dinheiro - Orçamento e Patrimônio' }));

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

// ====== Dynamic table helpers ======

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

// ====== Endpoints genéricos CRUD dinâmico ======

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

// ====== Endpoints analíticos ======

app.get('/api/resumo', async (req, res) => {
  try {
    const mesRef = req.query.mes || new Date().toISOString().slice(0, 7);
    await garantirTabela('transacoes', { tipo: '', categoria: '', valor: '', data: '', descricao: '' });
    const receitas = await query(
      `SELECT COALESCE(SUM(CAST(valor AS DECIMAL)), 0) as total FROM "transacoes"
       WHERE tipo='receita' AND data LIKE $1`, [mesRef + '%']
    );
    const despesas = await query(
      `SELECT COALESCE(SUM(CAST(valor AS DECIMAL)), 0) as total FROM "transacoes"
       WHERE tipo='despesa' AND data LIKE $1`, [mesRef + '%']
    );
    const receitaTotal = parseFloat(receitas[0]?.total || 0);
    const despesaTotal = parseFloat(despesas[0]?.total || 0);
    await garantirTabela('metas', { nome: '', valor_alvo: '', valor_atual: '', data_alvo: '', icone: '' });
    const metas = await query('SELECT * FROM "metas"');
    const totalAlvo = metas.reduce((s, m) => s + parseFloat(m.valor_alvo || 0), 0);
    const totalAtual = metas.reduce((s, m) => s + parseFloat(m.valor_atual || 0), 0);
    await garantirTabela('patrimonio', { tipo: '', nome: '', valor: '', categoria: '', data: '' });
    const ativos = await query(`SELECT COALESCE(SUM(CAST(valor AS DECIMAL)), 0) as total FROM "patrimonio" WHERE tipo='ativo'`);
    const passivos = await query(`SELECT COALESCE(SUM(CAST(valor AS DECIMAL)), 0) as total FROM "patrimonio" WHERE tipo='passivo'`);
    res.json({
      mes: mesRef,
      receitas: receitaTotal,
      despesas: despesaTotal,
      saldo: receitaTotal - despesaTotal,
      patrimonio_liquido: parseFloat(ativos[0]?.total || 0) - parseFloat(passivos[0]?.total || 0),
      progresso_metas: totalAlvo > 0 ? Math.round((totalAtual / totalAlvo) * 100) : 0
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/transacoes/:mes', async (req, res) => {
  try {
    const mes = req.params.mes.replace(/[^0-9-]/g, '');
    await garantirTabela('transacoes', { tipo: '', categoria: '', valor: '', data: '', descricao: '' });
    const rows = await query(
      `SELECT * FROM "transacoes" WHERE data LIKE $1 ORDER BY data DESC, _id DESC`, [mes + '%']
    );
    res.json(rows);
  } catch { res.json([]); }
});

app.get('/api/gastos-por-categoria/:mes', async (req, res) => {
  try {
    const mes = req.params.mes.replace(/[^0-9-]/g, '');
    await garantirTabela('transacoes', { tipo: '', categoria: '', valor: '', data: '', descricao: '' });
    await garantirTabela('categorias', { nome: '', tipo: '', orcamento_mensal: '', icone: '' });
    const gastos = await query(
      `SELECT categoria, SUM(CAST(valor AS DECIMAL)) as total FROM "transacoes"
       WHERE tipo='despesa' AND data LIKE $1 GROUP BY categoria`, [mes + '%']
    );
    const categorias = await query('SELECT * FROM "categorias"');
    const resultado = categorias.map(c => {
      const g = gastos.find(x => x.categoria === c.nome);
      return {
        id: c._id,
        nome: c.nome,
        icone: c.icone || '📦',
        gasto: g ? parseFloat(g.total) : 0,
        orcamento: parseFloat(c.orcamento_mensal || 0),
        progresso: parseFloat(c.orcamento_mensal || 0) > 0
          ? Math.round((parseFloat(g?.total || 0) / parseFloat(c.orcamento_mensal)) * 100)
          : 0
      };
    });
    res.json(resultado);
  } catch { res.json([]); }
});

app.get('/api/patrimonio/historico', async (req, res) => {
  try {
    const limite = parseInt(req.query.limite || '12');
    await garantirTabela('patrimonio', { tipo: '', nome: '', valor: '', categoria: '', data: '' });
    const rows = await query(`SELECT * FROM "patrimonio" ORDER BY data DESC, _id DESC LIMIT $1`, [limite * 10]);
    const meses = {};
    for (const r of rows) {
      const mes = (r.data || '').slice(0, 7);
      if (!mes) continue;
      if (!meses[mes]) meses[mes] = { ativos: 0, passivos: 0 };
      const v = parseFloat(r.valor || 0);
      if (r.tipo === 'ativo') meses[mes].ativos += v;
      else if (r.tipo === 'passivo') meses[mes].passivos += v;
    }
    const historico = Object.entries(meses)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-limite)
      .map(([mes, vals]) => ({
        mes, ativos: vals.ativos, passivos: vals.passivos,
        patrimonio: vals.ativos - vals.passivos
      }));
    res.json(historico);
  } catch { res.json([]); }
});

app.get('/api/metas/progresso', async (req, res) => {
  try {
    await garantirTabela('metas', { nome: '', valor_alvo: '', valor_atual: '', data_alvo: '', icone: '' });
    const rows = await query('SELECT * FROM "metas" ORDER BY _id ASC');
    const metas = rows.map(m => ({
      _id: m._id,
      nome: m.nome,
      icone: m.icone || '🎯',
      valor_alvo: parseFloat(m.valor_alvo || 0),
      valor_atual: parseFloat(m.valor_atual || 0),
      progresso: parseFloat(m.valor_alvo || 0) > 0
        ? Math.min(100, Math.round((parseFloat(m.valor_atual || 0) / parseFloat(m.valor_alvo || 0)) * 100))
        : 0,
      data_alvo: m.data_alvo || ''
    }));
    res.json(metas);
  } catch { res.json([]); }
});

// ====== Seed do admin ======

async function seedAdmin() {
  try {
    await garantirTabela('usuarios', { nome: '', usuario: '', celular: '', senha: '', role: '', createdAt: '' });
    await garantirColunas('usuarios', { role: '' });
    const user = process.env.ADMIN_USER || 'admin';
    const pass = process.env.ADMIN_PASS || 'admin';
    const rows = await query('SELECT _id FROM "usuarios" WHERE usuario=$1', [user]);
    if (!rows.length) {
      await query(
        `INSERT INTO "usuarios" (nome, usuario, celular, senha, role, "createdAt")
         VALUES ($1,$2,$3,$4,$5,$6)`,
        ['Administrador', user, '00000000000', pass, 'admin', new Date().toISOString()]
      );
      console.log(`✓ Admin criado (${user} / ${pass})`);
    } else {
      console.log(`✓ Admin já existe (${user})`);
    }
    // Cria categorias padrão se não existirem
    await garantirTabela('categorias', { nome: '', tipo: '', orcamento_mensal: '', icone: '' });
    const cats = await query('SELECT _id FROM "categorias"');
    if (!cats.length) {
      const padrao = [
        ['Moradia', 'despesa', '1500', '🏠'],
        ['Alimentação', 'despesa', '800', '🍽️'],
        ['Transporte', 'despesa', '400', '🚗'],
        ['Saúde', 'despesa', '300', '🏥'],
        ['Educação', 'despesa', '200', '📚'],
        ['Lazer', 'despesa', '300', '🎮'],
        ['Assinaturas', 'despesa', '100', '📺'],
        ['Salário', 'receita', '', '💰'],
        ['Freelance', 'receita', '', '💻'],
      ];
      for (const [nome, tipo, orc, icone] of padrao) {
        await query(
          `INSERT INTO "categorias" (nome, tipo, orcamento_mensal, icone) VALUES ($1,$2,$3,$4)`,
          [nome, tipo, orc, icone]
        );
      }
      console.log('✓ Categorias padrão criadas');
    }
  } catch (err) { console.error('Seed admin:', err.message); }
}

seedAdmin().then(() => app.listen(PORT, () => console.log(`Dinheiro API :${PORT}`)));
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
SKIP_BUILD=false
if [ -f "$INSTALL_DIR/docker-compose.yml" ] && [ -d "$SRC_DIR" ] && [ -f "$INSTALL_DIR/.env" ]; then
  info "Projeto já instalado — arquivos atualizados, reconstruindo..."
  SKIP_BUILD=true
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

# Test categorias
R=$(curl -s -X POST "${BASE}categorias" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"nome":"Teste Orçamento","tipo":"despesa","orcamento_mensal":"500","icone":"🧪"}' 2>/dev/null) || R=""
echo "$R" | grep -q '"nome"' && info "POST /categorias OK" || warn "POST /categorias falhou: $R"

# Test transacao
R2=$(curl -s -X POST "${BASE}transacoes" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"tipo":"despesa","categoria":"Teste Orçamento","valor":"100","data":"2026-07-04","descricao":"Teste"}' 2>/dev/null) || R2=""
echo "$R2" | grep -q '"tipo"' && info "POST /transacoes OK" || warn "POST /transacoes falhou: $R2"

# Test resumo
curl -sf "${BASE}api/resumo" -H "$AUTH" | grep -q '"mes"' && info "GET /api/resumo OK" || warn "GET /api/resumo falhou"

# Test endpoints analíticos
curl -sf "${BASE}api/gastos-por-categoria/2026-07" -H "$AUTH" | grep -q '\['
if [ $? -eq 0 ]; then
  info "GET /api/gastos-por-categoria OK"
else
  warn "GET /api/gastos-por-categoria falhou"
fi

# Test transacoes do mes
curl -sf "${BASE}api/transacoes/2026-07" -H "$AUTH" | grep -q '\['
if [ $? -eq 0 ]; then
  info "GET /api/transacoes OK"
else
  warn "GET /api/transacoes/2026-07 falhou"
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
echo "  Admin:         $ADMIN_USER / $ADMIN_PASS"
echo ""
mkdir -p "$SCRIPT_DIR/js"
echo "  Configuração de autodescoberta do frontend..."
cat > "$SCRIPT_DIR/js/config.js" <<CONFIGEOF
// Gerado automaticamente pela instalação
window.API_CONFIG = {
    baseUrl: 'https://api.projetosdinamicos.com.br/$PNAME/api'
};
CONFIGEOF
echo "  ✓ js/config.js gerado"
echo ""
echo "  Para desinstalar: sudo bash $0 uninstall $INSTALL_DIR"
echo ""
