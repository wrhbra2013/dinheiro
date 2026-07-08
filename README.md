# Dinheiro — Orçamento Pessoal e Reserva de Emergência

Aplicação web 100% estática para controle de **orçamento pessoal** e **formação de reserva de emergência**. Todos os dados ficam salvos no navegador (localStorage).

## Funcionalidades

- **Dashboard** — Visão geral com saldo do mês, patrimônio líquido, progresso de metas, orçamento e reserva de emergência
- **Transações** — Registrar receitas e despesas mensais com categorias
- **Orçamento** — Definir limites mensais por categoria e acompanhar progresso
- **Reserva de Emergência** — Calcula automaticamente o valor ideal (6x gasto médio), acompanha meses cobertos e progresso
- **Metas** — Cadastrar metas financeiras (gerais ou de reserva) com valor alvo
- **Patrimônio** — Registrar ativos e passivos para cálculo do patrimônio líquido
- **Exportar/Importar dados** — Backup completo em JSON

## Como usar

Acesse diretamente pelo navegador — nenhuma instalação necessária.

```
https://api.projetosdinamicos.com.br/dinheiro/
```

Ou baixe os arquivos e abra `index.html` no navegador.

## Instalação em servidor

```bash
sudo bash install_static.sh
```

O script copia os arquivos para `/var/www/dinheiro` e configura o Nginx.

## Arquitetura

- **Frontend**: HTML/CSS/JS puro (vanilla), sem frameworks
- **Armazenamento**: localStorage do navegador
- **Backend**: Nenhum — aplicação 100% estática

## Licença

MIT
