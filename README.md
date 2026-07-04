# Dinheiro — Orçamento e Formação de Patrimônio Pessoal

Aplicação web para controle de orçamento mensal, metas financeiras e acompanhamento de patrimônio pessoal.

## Funcionalidades

- **Dashboard** — Visão geral com saldo do mês, patrimônio líquido, progresso de metas e gastos por categoria
- **Transações** — Registrar receitas e despesas mensais com categorias
- **Orçamento** — Definir limites mensais por categoria e acompanhar progresso
- **Metas** — Cadastrar metas financeiras com valor alvo e acompanhamento de progresso
- **Patrimônio** — Registrar ativos e passivos para cálculo do patrimônio líquido

## Arquitetura

- **Backend**: Node.js + Express + PostgreSQL (Docker)
- **Frontend**: HTML/CSS/JS puro (vanilla)
- **API REST** com criação dinâmica de tabelas via POST
- **Infraestrutura**: Docker Compose, Nginx (proxy reverso)

## Instalação

```bash
sudo bash install_dinheiro.sh
```

O script configura Docker, PostgreSQL, Nginx e faz deploy da API.

## API

Todas as tabelas são criadas dinamicamente ao receber o primeiro POST.

### Endpoints públicos
- `GET /` — Status
- `GET /health` — Health check
- `GET /api-key` — Descobre o token

### Endpoints analíticos
- `GET /api/resumo?mes=2026-07` — Resumo do mês
- `GET /api/transacoes/2026-07` — Transações do mês
- `GET /api/gastos-por-categoria/2026-07` — Gastos agrupados
- `GET /api/metas/progresso` — Progresso das metas
- `GET /api/patrimonio/historico` — Histórico de patrimônio

### CRUD dinâmico
- `GET /:tabela` — Listar registros
- `POST /:tabela` — Criar registro (cria tabela/colunas automaticamente)
- `PUT /:tabela/:id` — Atualizar registro
- `DELETE /:tabela/:id` — Excluir registro

Tabelas principais: `transacoes`, `categorias`, `metas`, `patrimonio`, `usuarios`
