#!/bin/sh
set -eu

# ==============================================================
# Instalação — Dinheiro (versão estática)
# Deploy para api.projetosdinamicos.com.br
# ==============================================================
# Uso: sudo bash install_static.sh [uninstall]
# ==============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
INSTALL_DIR="/var/www/dinheiro"
NGINX_CONF="/etc/nginx/sites-available/dinheiro-static"
NGINX_ENABLED="/etc/nginx/sites-enabled/dinheiro-static"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { printf "${GREEN}[INFO]${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}[WARN]${NC} %s\n" "$1" >&2; }
error() { printf "${RED}[ERRO]${NC} %s\n" "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || error "Execute como root: sudo bash install_static.sh"


# ---------------------------------------------------------------
# uninstall
# ---------------------------------------------------------------
if [ "${1:-}" = "uninstall" ]; then
  INSTALL_DIR="${2:-$INSTALL_DIR}"

  info "Removendo diretório $INSTALL_DIR..."
  rm -rf "$INSTALL_DIR" && info "Diretório removido" || warn "Falha ao remover diretório"

  info "Removendo configuração do nginx..."
  rm -f "$NGINX_CONF"
  rm -f "$NGINX_ENABLED"

  nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true
  info "Desinstalação concluída"
  exit 0
fi


# ---------------------------------------------------------------
# Dependências
# ---------------------------------------------------------------
info "Verificando dependências..."
if ! command -v nginx >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -y -qq nginx
  info "Nginx instalado"
fi

if ! command -v rsync >/dev/null 2>&1; then
  apt-get install -y -qq rsync
fi


# ---------------------------------------------------------------
# Copiar arquivos
# ---------------------------------------------------------------
info "Copiando arquivos para $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
rsync -a --delete "$SCRIPT_DIR/" "$INSTALL_DIR/" \
  --exclude='.git' \
  --exclude='install_dinheiro.sh' \
  --exclude='install_static.sh' \
  --exclude='README.md' \
  --exclude='LICENSE'

# Ajustar permissões
chown -R www-data:www-data "$INSTALL_DIR" 2>/dev/null || true
find "$INSTALL_DIR" -type d -exec chmod 755 {} \;
find "$INSTALL_DIR" -type f -exec chmod 644 {} \;

info "Arquivos copiados"


# ---------------------------------------------------------------
# Configuração Nginx
# ---------------------------------------------------------------
info "Configurando Nginx..."

cat > "$NGINX_CONF" <<NGINXEOF
server {
    listen 80;
    server_name api.projetosdinamicos.com.br;

    root $INSTALL_DIR;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires max;
        add_header Cache-Control "public, immutable";
    }

    # Segurança básica
    location ~ /\. {
        deny all;
    }

    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options DENY;
}
NGINXEOF

if [ -f "/etc/nginx/sites-enabled/default" ]; then
  # Adiciona um location separado no server_name atual se já existir
  if ! grep -q "dinheiro-static" /etc/nginx/sites-enabled/default 2>/dev/null; then
    # Cria link simbólico para o site específico
    ln -sf "$NGINX_CONF" "$NGINX_ENABLED"
    info "Configuração adicional criada"
  fi
else
  ln -sf "$NGINX_CONF" "$NGINX_ENABLED"
  info "Configuração ativada"
fi

# Testar e recarregar
nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null && info "Nginx configurado com sucesso" || \
  warn "Falha no nginx — verifique manualmente"


# ---------------------------------------------------------------
# Teste
# ---------------------------------------------------------------
info "Testando..."
sleep 1
if curl -sf "http://127.0.0.1/" >/dev/null 2>&1; then
  info "Servidor respondendo"
else
  warn "Servidor não respondeu em http://127.0.0.1/"
fi

curl -sf "http://127.0.0.1/" | grep -q 'Dinheiro' && \
  info "Página inicial OK" || \
  warn "Página inicial não encontrada"


# ---------------------------------------------------------------
echo ""
info "===== Instalação concluída ====="
echo ""
echo "  URL:       https://api.projetosdinamicos.com.br/"
echo "  Diretório: $INSTALL_DIR"
echo ""
echo "  Para desinstalar: sudo bash $0 uninstall"
echo ""
