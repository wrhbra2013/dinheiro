let currentView = 'dashboard';
let currentDate = new Date();
let editingId = null;

function getMes() {
    const y = currentDate.getFullYear();
    const m = String(currentDate.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

function fmtMes(mes) {
    const [y, m] = mes.split('-');
    const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    return `${meses[parseInt(m)-1]} ${y}`;
}

function fmtValor(v) {
    if (v === null || v === undefined || isNaN(v)) v = 0;
    return 'R$ ' + parseFloat(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

document.addEventListener('DOMContentLoaded', async () => {
    await API.discover();
    const user = DB.get('session_user') || { nome: 'Admin' };
    document.getElementById('user-avatar').textContent = user.nome.charAt(0).toUpperCase();
    document.getElementById('user-name-sidebar').textContent = user.nome;
    if (API.isConfigured()) {
        document.getElementById('config-token').value = API.token;
        document.getElementById('config-url').value = API.baseUrl;
    }
    navigate('dashboard');
});

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('active');
}

// ====== Navegação ======
function navigate(view) {
    currentView = view;
    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.view === view);
    });
    document.querySelectorAll('.view').forEach(el => {
        el.classList.toggle('active', el.id === 'view-' + view);
    });
    const titles = { dashboard: 'Dashboard', transacoes: 'Transações', orcamento: 'Orçamento', metas: 'Metas', patrimonio: 'Patrimônio', config: 'Configuração' };
    document.getElementById('page-title').textContent = titles[view] || 'Dashboard';
    document.getElementById('month-picker').style.display = view === 'config' ? 'none' : 'flex';
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('active');
    renderView();
}

function renderView() {
    document.getElementById('current-month').textContent = fmtMes(getMes());
    switch (currentView) {
        case 'dashboard': renderDashboard(); break;
        case 'transacoes': renderTransacoes(); break;
        case 'orcamento': renderOrcamento(); break;
        case 'metas': renderMetas(); break;
        case 'patrimonio': renderPatrimonio(); break;
        default: renderDashboard();
    }
}

function changeMonth(delta) {
    currentDate.setMonth(currentDate.getMonth() + delta);
    renderView();
}

// ====== MODAL ======
function openModal(title, html) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = html;
    document.getElementById('modal-overlay').classList.add('active');
}

function closeModal() {
    document.getElementById('modal-overlay').classList.remove('active');
    editingId = null;
}

// ====== DASHBOARD ======
async function renderDashboard() {
    const mes = getMes();
    const resumo = await API.getResumo(mes);
    if (resumo) {
        document.getElementById('dash-saldo').textContent = fmtValor(resumo.saldo);
        document.getElementById('dash-receitas').innerHTML = fmtValor(resumo.receitas);
        document.getElementById('dash-despesas').innerHTML = fmtValor(resumo.despesas);
        document.getElementById('dash-patrimonio').textContent = fmtValor(resumo.patrimonio_liquido);
        const pct = resumo.progresso_metas || 0;
        document.getElementById('dash-metas-pct').textContent = pct + '%';
        document.getElementById('dash-metas-bar').style.width = pct + '%';

        const totalOrc = await calcOrcamentoProgresso(mes);
        if (totalOrc !== null) {
            document.getElementById('dash-orcamento-pct').textContent = totalOrc + '%';
            document.getElementById('dash-orcamento-bar').style.width = totalOrc + '%';
        }
    }
    renderDashCategorias(mes);
    renderDashMetas();
}

async function calcOrcamentoProgresso(mes) {
    const gastos = await API.getGastosPorCategoria(mes);
    if (!gastos.length) return 0;
    let totalGasto = 0, totalOrcamento = 0;
    for (const g of gastos) {
        totalGasto += g.gasto;
        totalOrcamento += g.orcamento;
    }
    return totalOrcamento > 0 ? Math.round((totalGasto / totalOrcamento) * 100) : 0;
}

async function renderDashCategorias(mes) {
    const container = document.getElementById('dash-categorias');
    const gastos = await API.getGastosPorCategoria(mes);
    const despesas = gastos.filter(g => g.gasto > 0).sort((a, b) => b.gasto - a.gasto).slice(0, 5);
    if (!despesas.length) {
        container.innerHTML = '<div class="empty-state">Nenhum gasto registrado</div>';
        return;
    }
    const maxValor = Math.max(...despesas.map(g => g.gasto));
    container.innerHTML = despesas.map(g => `
        <div class="cat-bar-item">
            <div class="cat-bar-label">
                <span>${g.icone} ${esc(g.nome)}</span>
                <span>${fmtValor(g.gasto)}</span>
            </div>
            <div class="cat-bar-track">
                <div class="cat-bar-fill" style="width:${maxValor > 0 ? (g.gasto/maxValor*100) : 0}%"></div>
            </div>
        </div>
    `).join('');
}

async function renderDashMetas() {
    const container = document.getElementById('dash-metas');
    const metas = await API.getMetas();
    if (!metas.length) {
        container.innerHTML = '<div class="empty-state">Nenhuma meta cadastrada</div>';
        return;
    }
    container.innerHTML = metas.slice(0, 4).map(m => `
        <div class="meta-item">
            <div class="meta-header">
                <span>${m.icone} ${esc(m.nome)}</span>
                <span class="meta-pct">${m.progresso}%</span>
            </div>
            <div class="progress-bar"><div class="progress-fill" style="width:${m.progresso}%"></div></div>
            <div class="meta-val">${fmtValor(m.valor_atual)} / ${fmtValor(m.valor_alvo)}</div>
        </div>
    `).join('');
}

// ====== TRANSAÇÕES ======
let filtroTransacoes = 'todas';

function filterTransacoes(tipo) {
    filtroTransacoes = tipo;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === tipo));
    renderTransacoes();
}

async function renderTransacoes() {
    const mes = getMes();
    const transacoes = await API.getTransacoes(mes);
    const container = document.getElementById('transacoes-list');
    let lista = transacoes;
    if (filtroTransacoes !== 'todas') {
        lista = transacoes.filter(t => t.tipo === filtroTransacoes);
    }
    if (!lista.length) {
        container.innerHTML = '<div class="empty-state">Nenhuma transação encontrada</div>';
        return;
    }
    container.innerHTML = lista.map(t => {
        const isReceita = t.tipo === 'receita';
        return `
            <div class="transacao-item">
                <div class="transacao-info">
                    <span class="transacao-categoria">${esc(t.categoria || 'Sem categoria')}</span>
                    <span class="transacao-descricao">${esc(t.descricao || '')}</span>
                    <span class="transacao-data">${t.data ? t.data.slice(8,10)+'/'+t.data.slice(5,7) : ''}</span>
                </div>
                <div class="transacao-valor ${isReceita ? 'receita' : 'despesa'}">
                    ${isReceita ? '+' : '-'}${fmtValor(t.valor)}
                </div>
                <button class="btn-del" onclick="deleteTransacao(${t._id})" title="Excluir">✕</button>
            </div>
        `;
    }).join('');
}

async function deleteTransacao(id) {
    if (!confirm('Excluir esta transação?')) return;
    await API.deleteTransacao(id);
    renderTransacoes();
    renderDashboard();
}

function openTransacaoModal() {
    editingId = null;
    const mes = getMes();
    openModal('Nova Transação', `
        <form onsubmit="salvarTransacao(event)" class="modal-form">
            <div class="form-group">
                <label>Tipo</label>
                <select id="input-tipo" required>
                    <option value="despesa">Despesa</option>
                    <option value="receita">Receita</option>
                </select>
            </div>
            <div class="form-group">
                <label>Categoria</label>
                <input type="text" id="input-categoria" placeholder="Ex: Alimentação" list="cat-list" required>
                <datalist id="cat-list"></datalist>
            </div>
            <div class="form-group">
                <label>Valor (R$)</label>
                <input type="number" id="input-valor" step="0.01" min="0.01" placeholder="0,00" required>
            </div>
            <div class="form-group">
                <label>Data</label>
                <input type="date" id="input-data" value="${mes}-${String(new Date().getDate()).padStart(2,'0')}" required>
            </div>
            <div class="form-group">
                <label>Descrição</label>
                <input type="text" id="input-descricao" placeholder="Opcional">
            </div>
            <button type="submit" class="btn btn-primary btn-block">Salvar</button>
        </form>
    `);
    loadCategoriaDatalist();
}

async function loadCategoriaDatalist() {
    const cats = await API.getCategorias();
    const dl = document.getElementById('cat-list');
    if (dl) dl.innerHTML = cats.map(c => `<option value="${esc(c.nome)}">`).join('');
}

async function salvarTransacao(e) {
    e.preventDefault();
    const data = {
        tipo: document.getElementById('input-tipo').value,
        categoria: document.getElementById('input-categoria').value.trim(),
        valor: document.getElementById('input-valor').value,
        data: document.getElementById('input-data').value,
        descricao: document.getElementById('input-descricao').value.trim()
    };
    if (editingId) {
        await API.updateTransacao(editingId, data);
    } else {
        await API.addTransacao(data);
    }
    closeModal();
    renderTransacoes();
    renderDashboard();
}

// ====== ORÇAMENTO ======
async function renderOrcamento() {
    const mes = getMes();
    const gastos = await API.getGastosPorCategoria(mes);
    const container = document.getElementById('orcamento-list');
    if (!gastos.length) {
        container.innerHTML = '<div class="empty-state">Nenhuma categoria configurada</div>';
        return;
    }
    container.innerHTML = gastos.map(g => `
        <div class="orcamento-item">
            <div class="orcamento-header">
                <span>${g.icone} ${esc(g.nome)}</span>
                <span class="orcamento-valores">
                    ${fmtValor(g.gasto)} / ${fmtValor(g.orcamento)}
                    <span class="orcamento-pct ${g.progresso > 100 ? 'danger' : g.progresso > 80 ? 'warning' : ''}">${g.progresso}%</span>
                </span>
            </div>
            <div class="progress-bar">
                <div class="progress-fill ${g.progresso > 100 ? 'fill-danger' : g.progresso > 80 ? 'fill-warning' : ''}" style="width:${Math.min(g.progresso, 100)}%"></div>
            </div>
            <div class="orcamento-actions">
                <button class="btn-del" onclick="deleteCategoria(${g.id})" title="Excluir">✕</button>
            </div>
        </div>
    `).join('');
}

async function deleteCategoria(id) {
    if (!confirm('Excluir esta categoria?')) return;
    await API.deleteCategoria(id);
    renderOrcamento();
}

function openCategoriaModal() {
    openModal('Nova Categoria', `
        <form onsubmit="salvarCategoria(event)" class="modal-form">
            <div class="form-group">
                <label>Nome</label>
                <input type="text" id="cat-nome" placeholder="Ex: Moradia" required>
            </div>
            <div class="form-group">
                <label>Tipo</label>
                <select id="cat-tipo" required>
                    <option value="despesa">Despesa</option>
                    <option value="receita">Receita</option>
                </select>
            </div>
            <div class="form-group">
                <label>Orçamento Mensal (R$) — apenas para despesas</label>
                <input type="number" id="cat-orcamento" step="0.01" min="0" placeholder="0,00">
            </div>
            <div class="form-group">
                <label>Ícone (emoji)</label>
                <input type="text" id="cat-icone" value="📦" maxlength="2">
            </div>
            <button type="submit" class="btn btn-primary btn-block">Salvar</button>
        </form>
    `);
}

async function salvarCategoria(e) {
    e.preventDefault();
    const data = {
        nome: document.getElementById('cat-nome').value.trim(),
        tipo: document.getElementById('cat-tipo').value,
        orcamento_mensal: document.getElementById('cat-orcamento').value || '0',
        icone: document.getElementById('cat-icone').value || '📦'
    };
    await API.addCategoria(data);
    closeModal();
    renderOrcamento();
    renderDashboard();
}

// ====== METAS ======
async function renderMetas() {
    const metas = await API.getMetas();
    const container = document.getElementById('metas-list');
    if (!metas.length) {
        container.innerHTML = '<div class="empty-state">Nenhuma meta cadastrada</div>';
        return;
    }
    container.innerHTML = metas.map(m => `
        <div class="meta-card">
            <div class="meta-card-header">
                <span class="meta-icon">${m.icone}</span>
                <div class="meta-card-info">
                    <strong>${esc(m.nome)}</strong>
                    ${m.data_alvo ? `<small>Até ${m.data_alvo.slice(8,10)}/${m.data_alvo.slice(5,7)}/${m.data_alvo.slice(0,4)}</small>` : ''}
                </div>
                <span class="meta-pct-big">${m.progresso}%</span>
            </div>
            <div class="progress-bar"><div class="progress-fill" style="width:${m.progresso}%"></div></div>
            <div class="meta-card-val">
                <span>${fmtValor(m.valor_atual)}</span>
                <span>${fmtValor(m.valor_alvo)}</span>
            </div>
            <div class="meta-card-actions">
                <button class="btn btn-sm btn-secondary" onclick="addMetaProgresso(${m._id})">+ Adicionar</button>
                <button class="btn-del" onclick="deleteMeta(${m._id})" title="Excluir">✕</button>
            </div>
        </div>
    `).join('');
}

async function addMetaProgresso(id) {
    const valor = prompt('Quanto deseja adicionar à meta? (R$)');
    if (!valor || isNaN(valor)) return;
    const metas = await API.getMetas();
    const meta = metas.find(m => m._id === id);
    if (!meta) return;
    const novoAtual = (meta.valor_atual || 0) + parseFloat(valor);
    await API.updateMeta(id, {
        nome: meta.nome,
        valor_alvo: meta.valor_alvo,
        valor_atual: String(novoAtual),
        data_alvo: meta.data_alvo,
        icone: meta.icone
    });
    renderMetas();
    renderDashboard();
}

async function deleteMeta(id) {
    if (!confirm('Excluir esta meta?')) return;
    await API.deleteMeta(id);
    renderMetas();
    renderDashboard();
}

function openMetaModal() {
    openModal('Nova Meta', `
        <form onsubmit="salvarMeta(event)" class="modal-form">
            <div class="form-group">
                <label>Nome da Meta</label>
                <input type="text" id="meta-nome" placeholder="Ex: Reserva de Emergência" required>
            </div>
            <div class="form-group">
                <label>Valor Alvo (R$)</label>
                <input type="number" id="meta-alvo" step="0.01" min="0.01" placeholder="0,00" required>
            </div>
            <div class="form-group">
                <label>Valor Atual (R$)</label>
                <input type="number" id="meta-atual" step="0.01" min="0" placeholder="0,00" value="0">
            </div>
            <div class="form-group">
                <label>Data Alvo</label>
                <input type="date" id="meta-data">
            </div>
            <div class="form-group">
                <label>Ícone (emoji)</label>
                <input type="text" id="meta-icone" value="🎯" maxlength="2">
            </div>
            <button type="submit" class="btn btn-primary btn-block">Salvar</button>
        </form>
    `);
}

async function salvarMeta(e) {
    e.preventDefault();
    const data = {
        nome: document.getElementById('meta-nome').value.trim(),
        valor_alvo: document.getElementById('meta-alvo').value,
        valor_atual: document.getElementById('meta-atual').value || '0',
        data_alvo: document.getElementById('meta-data').value || '',
        icone: document.getElementById('meta-icone').value || '🎯'
    };
    await API.addMeta(data);
    closeModal();
    renderMetas();
    renderDashboard();
}

// ====== PATRIMÔNIO ======
async function renderPatrimonio() {
    const items = await API.getPatrimonio();
    const ativos = items.filter(i => i.tipo === 'ativo');
    const passivos = items.filter(i => i.tipo === 'passivo');

    const containerAtivos = document.getElementById('patrimonio-ativos');
    const containerPassivos = document.getElementById('patrimonio-passivos');

    function renderList(arr, container) {
        if (!arr.length) {
            container.innerHTML = '<div class="empty-state">Nenhum item</div>';
            return;
        }
        container.innerHTML = arr.map(i => `
            <div class="pat-item">
                <div class="pat-info">
                    <span class="pat-nome">${i.icone ? i.icone + ' ' : ''}${esc(i.nome)}</span>
                    <span class="pat-cat">${esc(i.categoria || '')}</span>
                </div>
                <div class="pat-valor">${fmtValor(i.valor)}</div>
                <button class="btn-del" onclick="deletePatrimonio(${i._id})" title="Excluir">✕</button>
            </div>
        `).join('');
    }

    renderList(ativos, containerAtivos);
    renderList(passivos, containerPassivos);
}

async function deletePatrimonio(id) {
    if (!confirm('Excluir este item?')) return;
    await API.deletePatrimonio(id);
    renderPatrimonio();
    renderDashboard();
}

function openPatrimonioModal() {
    openModal('Novo Item Patrimonial', `
        <form onsubmit="salvarPatrimonio(event)" class="modal-form">
            <div class="form-group">
                <label>Tipo</label>
                <select id="pat-tipo" required>
                    <option value="ativo">Ativo</option>
                    <option value="passivo">Passivo</option>
                </select>
            </div>
            <div class="form-group">
                <label>Nome</label>
                <input type="text" id="pat-nome" placeholder="Ex: Imóvel, Carro, Ações" required>
            </div>
            <div class="form-group">
                <label>Valor (R$)</label>
                <input type="number" id="pat-valor" step="0.01" min="0" placeholder="0,00" required>
            </div>
            <div class="form-group">
                <label>Categoria</label>
                <input type="text" id="pat-categoria" placeholder="Ex: Imóveis, Investimentos, Veículos">
            </div>
            <div class="form-group">
                <label>Ícone (emoji)</label>
                <input type="text" id="pat-icone" value="🏦" maxlength="2">
            </div>
            <button type="submit" class="btn btn-primary btn-block">Salvar</button>
        </form>
    `);
}

async function salvarPatrimonio(e) {
    e.preventDefault();
    const data = {
        tipo: document.getElementById('pat-tipo').value,
        nome: document.getElementById('pat-nome').value.trim(),
        valor: document.getElementById('pat-valor').value,
        categoria: document.getElementById('pat-categoria').value.trim() || '',
        icone: document.getElementById('pat-icone').value || '🏦',
        data: new Date().toISOString().slice(0, 10)
    };
    await API.addPatrimonio(data);
    closeModal();
    renderPatrimonio();
    renderDashboard();
}
