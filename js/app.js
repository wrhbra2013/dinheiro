const CATEGORIAS_RECEITA = {
    salario: 'Salário',
    freelance: 'Freelance',
    investimento: 'Investimento',
    presente: 'Presente',
    outros: 'Outros'
};

const CATEGORIAS_DESPESA = {
    alimentacao: 'Alimentação',
    transporte: 'Transporte',
    moradia: 'Moradia',
    lazer: 'Lazer',
    saude: 'Saúde',
    educacao: 'Educação',
    outros: 'Outros'
};

function esc(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str ?? ''));
    return div.innerHTML;
}

let dados = {
    receitas: [],
    despesas: [],
    metas: [],
    naos: []
};

document.addEventListener('DOMContentLoaded', () => {
    loadData();
    initDefaultDate();
    renderAll();
    loadApiConfigForm();
});

function initDefaultDate() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('receita-data').value = today;
    document.getElementById('despesa-data').value = today;
    document.getElementById('orc-data').value = today;
    document.getElementById('inv-data').value = today;
    initMonthFilter();
}

function initMonthFilter() {
    const select = document.getElementById('report-month');
    const months = [];
    for (let i = 0; i < 12; i++) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const month = d.toISOString().slice(0, 7);
        const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        months.push({ value: month, label });
    }
    select.innerHTML = '<option value="">Selecione o mês</option>' +
        months.map(m => `<option value="${m.value}">${m.label}</option>`).join('');
}

function loadData() {
    try {
        const saved = localStorage.getItem('finance_data');
        if (saved) {
            dados = JSON.parse(saved);
        }
    } catch {
        dados = { receitas: [], despesas: [], metas: [], naos: [] };
    }
}

function saveData() {
    localStorage.setItem('finance_data', JSON.stringify(dados));
}

function renderAll() {
    renderDashboard();
    renderReceitas();
    renderDespesas();
    renderMetas();
    renderReports();
    renderOrcamento();
    renderInvestimentos();
}

function switchView(view) {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });
    document.querySelectorAll('.view').forEach(v => {
        v.classList.toggle('active', v.id === 'view-' + view);
    });
    if (view === 'orcamento') renderOrcamento();
    if (view === 'investimentos') renderInvestimentos();
}

function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('pt-BR');
}

// ============= DASHBOARD =============
function renderDashboard() {
    const totalReceitas = dados.receitas.reduce((sum, r) => sum + r.valor, 0);
    const totalDespesas = dados.despesas.reduce((sum, d) => sum + d.valor, 0);
    const saldo = totalReceitas - totalDespesas;
    const metasAtivas = dados.metas.length;

    document.getElementById('dash-receitas').textContent = formatCurrency(totalReceitas);
    document.getElementById('dash-despesas').textContent = formatCurrency(totalDespesas);
    document.getElementById('dash-saldo').textContent = formatCurrency(saldo);
    document.getElementById('dash-metas').textContent = metasAtivas;
    document.getElementById('header-balance').textContent = formatCurrency(saldo);

    renderRecentTransactions();
    renderGoalsProgress();
    renderCategoryChart();
    renderParetoAnalysis();
    renderDebtWarning();
    renderConsciousConsumption();
    renderNaoList();
}

function renderRecentTransactions() {
    const all = [
        ...dados.receitas.map(r => ({ ...r, tipo: 'receita' })),
        ...dados.despesas.map(d => ({ ...d, tipo: 'despesa' }))
    ].sort((a, b) => new Date(b.data) - new Date(a.data)).slice(0, 5);

    const container = document.getElementById('recent-transactions');
    if (!all.length) {
        container.innerHTML = '<p style="color: var(--text2); text-align: center;">Nenhuma transação</p>';
        return;
    }
    container.innerHTML = all.map(t => `
        <div class="transaction-item">
            <div class="transaction-info">
                <span class="transaction-desc">${esc(t.descricao)}</span>
                <span class="transaction-date">${formatDate(t.data)} • ${esc(t.tipo === 'receita' ? CATEGORIAS_RECEITA[t.categoria] : CATEGORIAS_DESPESA[t.categoria])}</span>
            </div>
            <span class="transaction-amount ${t.tipo}">${t.tipo === 'receita' ? '+' : '-'}${formatCurrency(t.valor)}</span>
        </div>
    `).join('');
}

function renderGoalsProgress() {
    const container = document.getElementById('goals-progress');
    const now = Date.now();

    if (!dados.metas.length) {
        container.innerHTML = '<p style="color: var(--text2); text-align: center;">Nenhuma meta definida</p>';
        return;
    }
    container.innerHTML = dados.metas.map(m => {
        const saved = m.valorAtual || 0;
        const percent = Math.min((saved / m.valor) * 100, 100);
        const daysLeft = Math.ceil((new Date(m.dataLimite) - now) / (1000 * 60 * 60 * 24));
        
        return `
            <div class="goal-card">
                <h4>${esc(m.nome)}</h4>
                <div class="goal-progress">
                    <div class="goal-progress-bar">
                        <div class="goal-progress-fill ${percent >= 100 ? 'complete' : ''}" style="width: ${percent}%"></div>
                    </div>
                </div>
                <div class="goal-info">
                    <span>${formatCurrency(saved)} / ${formatCurrency(m.valor)}</span>
                    <span>${percent.toFixed(0)}% • ${daysLeft > 0 ? daysLeft + ' dias' : 'Tempo esgotado'}</span>
                </div>
            </div>
        `;
    }).join('');
}

function renderCategoryChart() {
    const categoryTotals = {};
    dados.despesas.forEach(d => {
        categoryTotals[d.categoria] = (categoryTotals[d.categoria] || 0) + d.valor;
    });

    const sorted = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
    const max = sorted.length ? sorted[0][1] : 1;

    const container = document.getElementById('category-chart');
    if (!sorted.length) {
        container.innerHTML = '<p style="color: var(--text2); margin: auto;">Nenhuma despesa registrada</p>';
        return;
    }
    container.innerHTML = sorted.slice(0, 6).map(([cat, total]) => `
        <div class="chart-bar-item">
            <div class="chart-bar" style="height: ${(total / max) * 150}px; background: var(--accent);"></div>
            <span class="chart-label">${esc(CATEGORIAS_DESPESA[cat] || cat)}</span>
            <span style="font-size: 11px; color: var(--text2)">${formatCurrency(total)}</span>
        </div>
    `).join('');
}

// ============= RECEITAS =============
function renderReceitas() {
    const sorted = [...dados.receitas].sort((a, b) => new Date(b.data) - new Date(a.data));
    const total = sorted.reduce((sum, r) => sum + r.valor, 0);

    document.getElementById('total-receitas').textContent = formatCurrency(total);

    const tbody = document.getElementById('receitas-table');
    if (!sorted.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text2)">Nenhuma receita registrada</td></tr>';
        return;
    }
    tbody.innerHTML = sorted.map(r => `
        <tr>
            <td>${formatDate(r.data)}</td>
            <td>${esc(r.descricao)}</td>
            <td>${esc(CATEGORIAS_RECEITA[r.categoria])}</td>
            <td class="amount income">${formatCurrency(r.valor)}</td>
            <td>
                <button class="btn btn-sm btn-danger" onclick="deleteReceita(${r.id})">🗑️</button>
            </td>
        </tr>
    `).join('');
}

function addReceita(e) {
    e.preventDefault();
    const desc = document.getElementById('receita-desc').value.replace(/<[^>]*>/g, '');
    const val = parseFloat(document.getElementById('receita-valor').value);
    if (isNaN(val) || val <= 0) return;
    dados.receitas.push({
        id: Date.now(),
        descricao: desc,
        valor: val,
        data: document.getElementById('receita-data').value,
        categoria: document.getElementById('receita-categoria').value
    });
    saveData();
    renderAll();
    closeModal('receita');
    e.target.reset();
    initDefaultDate();
}

function deleteReceita(id) {
    if (confirm('Excluir esta receita?')) {
        dados.receitas = dados.receitas.filter(r => r.id !== id);
        saveData();
        renderAll();
    }
}

// ============= DESPESAS =============
function renderDespesas() {
    const sorted = [...dados.despesas].sort((a, b) => new Date(b.data) - new Date(a.data));
    const total = sorted.reduce((sum, d) => sum + d.valor, 0);

    document.getElementById('total-despesas').textContent = formatCurrency(total);

    const tbody = document.getElementById('despesas-table');
    if (!sorted.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text2)">Nenhuma despesa registrada</td></tr>';
        return;
    }
    tbody.innerHTML = sorted.map(d => `
        <tr>
            <td>${formatDate(d.data)}</td>
            <td>${esc(d.descricao)}</td>
            <td>${esc(CATEGORIAS_DESPESA[d.categoria])} <span class="badge ${d.essencial !== false ? 'badge-essential' : 'badge-optional'}">${d.essencial !== false ? 'Essencial' : 'Supérfluo'}</span></td>
            <td class="amount expense">-${formatCurrency(d.valor)}</td>
            <td>
                <button class="btn btn-sm btn-danger" onclick="deleteDespesa(${d.id})">🗑️</button>
            </td>
        </tr>
    `).join('');
}

function addDespesa(e) {
    e.preventDefault();
    const desc = document.getElementById('despesa-desc').value.replace(/<[^>]*>/g, '');
    const val = parseFloat(document.getElementById('despesa-valor').value);
    if (isNaN(val) || val <= 0) return;
    dados.despesas.push({
        id: Date.now(),
        descricao: desc,
        valor: val,
        data: document.getElementById('despesa-data').value,
        categoria: document.getElementById('despesa-categoria').value,
        essencial: document.getElementById('despesa-essencial').checked
    });
    saveData();
    renderAll();
    closeModal('despesa');
    e.target.reset();
    initDefaultDate();
}

function deleteDespesa(id) {
    if (confirm('Excluir esta despesa?')) {
        dados.despesas = dados.despesas.filter(d => d.id !== id);
        saveData();
        renderAll();
    }
}

// ============= METAS =============
function renderMetas() {
    const container = document.getElementById('goals-grid');
    const now = Date.now();

    if (!dados.metas.length) {
        container.innerHTML = '<p style="color: var(--text2); grid-column: 1/-1; text-align: center;">Nenhuma meta definida</p>';
        return;
    }
    container.innerHTML = dados.metas.map(m => {
        const saved = m.valorAtual || 0;
        const percent = Math.min((saved / m.valor) * 100, 100);
        const daysLeft = Math.ceil((new Date(m.dataLimite) - now) / (1000 * 60 * 60 * 24));

        return `
            <div class="goal-card">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
                    <h4>${esc(m.nome)}</h4>
                    <button class="btn btn-sm btn-danger" onclick="deleteMeta(${m.id})">🗑️</button>
                </div>
                <p>${esc(m.descricao || '')}</p>
                <div class="goal-progress">
                    <div class="goal-progress-bar">
                        <div class="goal-progress-fill ${percent >= 100 ? 'complete' : ''}" style="width: ${percent}%"></div>
                    </div>
                </div>
                <div class="goal-info">
                    <span>${formatCurrency(saved)} / ${formatCurrency(m.valor)}</span>
                    <span>${percent.toFixed(0)}% • ${daysLeft > 0 ? daysLeft + ' dias' : 'Tempo esgotado'}</span>
                </div>
                <div style="margin-top: 12px; display: flex; gap: 8px;">
                    <input type="number" id="add-meta-${m.id}" placeholder="Valor" style="flex: 1; padding: 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text);" step="0.01">
                    <button class="btn btn-sm btn-primary" onclick="addToMeta(${m.id})">+</button>
                </div>
            </div>
        `;
    }).join('');
}

function addMeta(e) {
    e.preventDefault();
    const nome = document.getElementById('meta-nome').value.replace(/<[^>]*>/g, '');
    const desc = document.getElementById('meta-desc').value.replace(/<[^>]*>/g, '');
    const val = parseFloat(document.getElementById('meta-valor').value);
    if (isNaN(val) || val <= 0) return;
    dados.metas.push({
        id: Date.now(),
        nome: nome,
        descricao: desc,
        valor: val,
        valorAtual: 0,
        dataLimite: document.getElementById('meta-data').value
    });
    saveData();
    renderAll();
    closeModal('meta');
    e.target.reset();
}

function deleteMeta(id) {
    if (confirm('Excluir esta meta?')) {
        dados.metas = dados.metas.filter(m => m.id !== id);
        saveData();
        renderAll();
    }
}

function addToMeta(id) {
    const input = document.getElementById(`add-meta-${id}`);
    const value = parseFloat(input.value);
    if (value > 0) {
        const meta = dados.metas.find(m => m.id === id);
        if (meta) {
            meta.valorAtual = (meta.valorAtual || 0) + value;
            saveData();
            renderAll();
        }
    }
}

// ============= RELATÓRIOS =============
function renderReports() {
    const month = document.getElementById('report-month').value;
    
    const receitasMes = month 
        ? dados.receitas.filter(r => r.data.startsWith(month)) 
        : dados.receitas;
    const despesasMes = month 
        ? dados.despesas.filter(d => d.data.startsWith(month)) 
        : dados.despesas;

    const totalReceitas = receitasMes.reduce((sum, r) => sum + r.valor, 0);
    const totalDespesas = despesasMes.reduce((sum, d) => sum + d.valor, 0);
    const saldo = totalReceitas - totalDespesas;

    document.getElementById('report-receitas').textContent = formatCurrency(totalReceitas);
    document.getElementById('report-despesas').textContent = formatCurrency(totalDespesas);
    document.getElementById('report-saldo').textContent = formatCurrency(saldo);

    renderMonthlyComparison();
}

function renderMonthlyComparison() {
    const months = {};
    dados.receitas.forEach(r => {
        const m = r.data.slice(0, 7);
        months[m] = months[m] || { receitas: 0, despesas: 0 };
        months[m].receitas += r.valor;
    });
    dados.despesas.forEach(d => {
        const m = d.data.slice(0, 7);
        months[m] = months[m] || { receitas: 0, despesas: 0 };
        months[m].despesas += d.valor;
    });

    const sorted = Object.entries(months).sort().slice(-6);
    const max = Math.max(...sorted.map(([, d]) => Math.max(d.receitas, d.despesas)), 1);

    const container = document.getElementById('monthly-comparison');
    if (!sorted.length) {
        container.innerHTML = '<p style="color: var(--text2); margin: auto;">Sem dados suficientes</p>';
        return;
    }
    container.innerHTML = sorted.map(([m, d]) => {
        const label = new Date(m + '-01').toLocaleDateString('pt-BR', { month: 'short' });
        return `
            <div class="chart-bar-item">
                <div style="display: flex; flex-direction: column; align-items: center; gap: 4px; width: 100%;">
                    <div style="display: flex; gap: 4px; align-items: flex-end; height: 150px;">
                        <div class="chart-bar" style="height: ${(d.receitas / max) * 140}px; background: var(--income);"></div>
                        <div class="chart-bar" style="height: ${(d.despesas / max) * 140}px; background: var(--expense);"></div>
                    </div>
                    <span class="chart-label">${esc(label)}</span>
                </div>
            </div>
        `;
    }).join('');
}

// ============= PARETO 80/20 =============
function renderParetoAnalysis() {
    const container = document.getElementById('pareto-analysis');
    const catTotals = {};
    dados.despesas.forEach(d => {
        catTotals[d.categoria] = (catTotals[d.categoria] || 0) + d.valor;
    });

    const entries = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, [, v]) => s + v, 0);

    if (!total) {
        container.innerHTML = '<p style="color:var(--text2)">Adicione despesas para ver a análise</p>';
        return;
    }

    const top20pct = Math.ceil(entries.length * 0.2) || 1;
    let vitalSum = 0;
    entries.forEach(([, v], i) => {
        if (i < top20pct) vitalSum += v;
    });
    const vitalPct = ((vitalSum / total) * 100).toFixed(0);

    let html = `<div class="insight-grid">`;
    html += `<div class="insight-item"><span class="label">${entries.length} categorias no total</span><span class="value">${formatCurrency(total)}</span></div>`;
    html += `<div class="insight-item"><span class="label">Top ${top20pct} categorias (20%)</span><span class="value highlight">${formatCurrency(vitalSum)} (${vitalPct}%)</span></div>`;
    html += `<div style="font-size:12px;color:var(--text2);padding:8px 0;border-top:1px solid var(--border)">📌 ${vitalPct}% dos gastos vêm de apenas ${top20pct} categorias. Foque em reduzir estas.</div>`;
    html += `</div>`;

    html += `<div style="margin-top:12px">`;
    entries.slice(0, top20pct).forEach(([cat, val]) => {
        const pct = ((val / total) * 100).toFixed(0);
        html += `<div class="insight-item"><span class="label">${esc(CATEGORIAS_DESPESA[cat] || cat)}</span><span class="value highlight">${formatCurrency(val)} (${pct}%)</span></div>`;
    });
    html += `</div>`;

    container.innerHTML = html;
}

// ============= REGRA 1: EVITAR DÍVIDAS =============
function renderDebtWarning() {
    const container = document.getElementById('debt-warning');
    const totalRec = dados.receitas.reduce((s, r) => s + r.valor, 0);
    const totalDesp = dados.despesas.reduce((s, d) => s + d.valor, 0);
    const saldo = totalRec - totalDesp;

    if (saldo < 0) {
        container.innerHTML = `
            <div class="warning-banner danger">
                <span style="font-size:24px">🚨</span>
                <div>
                    <strong>Saldo negativo!</strong><br>
                    <span style="font-size:13px">Despesas (${formatCurrency(totalDesp)}) excedem receitas (${formatCurrency(totalRec)}) em ${formatCurrency(Math.abs(saldo))}.</span>
                </div>
            </div>
            <div class="insight-grid" style="margin-top:12px">
                <div class="insight-item"><span class="label">Déficit total</span><span class="value highlight">${formatCurrency(Math.abs(saldo))}</span></div>
                <div style="font-size:12px;color:var(--text2)">⚠️ Evite novas dívidas. Corte gastos supérfluos temporariamente.</div>
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="warning-banner success">
                <span style="font-size:24px">✅</span>
                <div>
                    <strong>Contas em dia!</strong><br>
                    <span style="font-size:13px">Receitas (${formatCurrency(totalRec)}) ≥ Despesas (${formatCurrency(totalDesp)}). Saldo positivo de ${formatCurrency(saldo)}.</span>
                </div>
            </div>
            <div class="insight-grid" style="margin-top:12px">
                <div class="insight-item"><span class="label">Saldo disponível</span><span class="value good">${formatCurrency(saldo)}</span></div>
                <div style="font-size:12px;color:var(--text2)">💡 Direcione o excedente para metas de economia.</div>
            </div>
        `;
    }
}

// ============= REGRA 2: CONSUMO CONSCIENTE =============
function renderConsciousConsumption() {
    const container = document.getElementById('conscious-consumption');
    const total = dados.despesas.reduce((s, d) => s + d.valor, 0);
    const essencial = dados.despesas.filter(d => d.essencial !== false).reduce((s, d) => s + d.valor, 0);
    const superfluo = dados.despesas.filter(d => d.essencial === false).reduce((s, d) => s + d.valor, 0);

    if (!total) {
        container.innerHTML = '<p style="color:var(--text2)">Adicione despesas para ver a análise</p>';
        return;
    }

    const essPct = ((essencial / total) * 100).toFixed(0);
    const supPct = ((superfluo / total) * 100).toFixed(0);

    container.innerHTML = `
        <div class="insight-grid">
            <div class="insight-item">
                <span class="label">✅ Essencial</span>
                <span class="value">${formatCurrency(essencial)} (${essPct}%)</span>
            </div>
            <div class="insight-item">
                <span class="label">❌ Supérfluo</span>
                <span class="value highlight">${formatCurrency(superfluo)} (${supPct}%)</span>
            </div>
            <div style="height:8px;background:var(--bg3);border-radius:4px;overflow:hidden">
                <div style="height:100%;width:${essPct}%;background:var(--success);float:left"></div>
                <div style="height:100%;width:${supPct}%;background:var(--warning);float:left"></div>
            </div>
            ${superfluo > 0 ? `<div style="font-size:12px;color:var(--text2);padding-top:8px">💡 ${formatCurrency(superfluo)} em supérfluos — cada real economizado aqui acelera suas metas.</div>` : '<div style="font-size:12px;color:var(--success);padding-top:8px">🎯 100% dos gastos são essenciais! Ótimo consumo consciente.</div>'}
        </div>
    `;
}

// ============= REGRA 3: APRENDER A DIZER NÃO =============
function addNao(e) {
    e.preventDefault();
    const desc = document.getElementById('nao-desc').value.replace(/<[^>]*>/g, '');
    const val = parseFloat(document.getElementById('nao-valor').value);
    if (isNaN(val) || val <= 0) return;
    dados.naos.push({
        id: Date.now(),
        descricao: desc,
        valor: val,
        data: new Date().toISOString().split('T')[0]
    });
    saveData();
    renderAll();
    closeModal('nao');
    e.target.reset();
}

function deleteNao(id) {
    if (confirm('Remover este registro?')) {
        dados.naos = dados.naos.filter(n => n.id !== id);
        saveData();
        renderAll();
    }
}

function renderNaoList() {
    const container = document.getElementById('nao-list');
    const totalEconomizado = dados.naos.reduce((s, n) => s + n.valor, 0);

    let html = '';
    if (totalEconomizado > 0) {
        html += `<div class="insight-item" style="margin-bottom:12px"><span class="label">💰 Total economizado</span><span class="value good">${formatCurrency(totalEconomizado)}</span></div>`;
    }

    const sorted = [...dados.naos].sort((a, b) => new Date(b.data) - new Date(a.data));
    if (!sorted.length) {
        html += '<p style="color:var(--text2);font-size:13px">Nenhum registro ainda. Cada "não" vira economia real.</p>';
    } else {
        html += sorted.map(n => `
            <div class="nao-item">
                <div class="nao-info">
                    <span class="nao-desc">${esc(n.descricao)}</span>
                    <span class="nao-date">${formatDate(n.data)}</span>
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                    <span class="nao-valor">+${formatCurrency(n.valor)}</span>
                    <button class="btn btn-sm btn-danger" onclick="deleteNao(${n.id})">🗑️</button>
                </div>
            </div>
        `).join('');
    }

    container.innerHTML = html;
}

// ============= API CONFIG =============
function loadApiConfigForm() {
    const cfg = API.config;
    document.getElementById('api-url').value = cfg.baseUrl || '';
    document.getElementById('api-token').value = cfg.token || '';
    document.getElementById('api-project').value = cfg.project || 'dinheiro';
}

function saveApiConfig() {
    API.config = {
        baseUrl: document.getElementById('api-url').value.replace(/\/+$/, ''),
        token: document.getElementById('api-token').value,
        project: document.getElementById('api-project').value
    };
    document.getElementById('api-status').innerHTML = '<span style="color:var(--success)">✓ Configuração salva</span>';
    closeModal('api-config');
}

async function testApi() {
    const status = document.getElementById('api-status');
    const oldUrl = API.config.baseUrl;
    const oldToken = API.config.token;
    API.config = {
        baseUrl: document.getElementById('api-url').value.replace(/\/+$/, ''),
        token: document.getElementById('api-token').value,
        project: document.getElementById('api-project').value
    };
    try {
        const res = await API.health();
        if (res.status === 'healthy') {
            status.innerHTML = '<span style="color:var(--success)">✓ API conectada e saudável</span>';
        } else {
            status.innerHTML = '<span style="color:var(--warning)">⚠ API respondeu mas status: ' + esc(res.status) + '</span>';
        }
    } catch (e) {
        status.innerHTML = '<span style="color:var(--danger)">✗ Erro: ' + esc(e.message) + '</span>';
        API.config = { baseUrl: oldUrl, token: oldToken, project: document.getElementById('api-project').value };
    }
}

// ============= ORÇAMENTO VIA API =============
let orcamentoData = [];

async function renderOrcamento() {
    const tbody = document.getElementById('orcamento-table');
    if (!API.isConfigured()) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text2)">Configure a API no menu ⚙️ API</td></tr>';
        return;
    }
    try {
        orcamentoData = await API.list('orcamento');
    } catch {
        orcamentoData = [];
    }
    const sorted = [...orcamentoData].sort((a, b) => new Date(b.data || b.created_at) - new Date(a.data || a.created_at));
    const total = sorted.reduce((s, r) => s + parseFloat(r.valor || 0), 0);

    document.getElementById('total-orcamento').textContent = formatCurrency(total);

    if (!sorted.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text2)">Nenhum item de orçamento</td></tr>';
        return;
    }
    tbody.innerHTML = sorted.map(r => `
        <tr>
            <td>${formatDate(r.data || r.created_at)}</td>
            <td>${esc(r.descricao)}</td>
            <td>${esc(r.categoria)}</td>
            <td><span class="badge ${r.tipo === 'receita' ? 'badge-essential' : 'badge-optional'}">${r.tipo === 'receita' ? 'Receita' : 'Despesa'}</span></td>
            <td class="amount ${r.tipo === 'receita' ? 'income' : 'expense'}">${r.tipo === 'receita' ? '' : '-'}${formatCurrency(parseFloat(r.valor))}</td>
            <td><button class="btn btn-sm btn-danger" onclick="deleteOrcamento(${r._id})">🗑️</button></td>
        </tr>
    `).join('');
}

async function addOrcamento(e) {
    e.preventDefault();
    if (!API.isConfigured()) { alert('Configure a API primeiro!'); return; }
    const desc = document.getElementById('orc-desc').value.replace(/<[^>]*>/g, '');
    const val = parseFloat(document.getElementById('orc-valor').value);
    if (isNaN(val) || val <= 0) return;
    try {
        await API.create('orcamento', {
            descricao: desc,
            valor: val,
            data: document.getElementById('orc-data').value,
            categoria: document.getElementById('orc-categoria').value,
            tipo: document.getElementById('orc-tipo').value,
            project: API.project
        });
        renderOrcamento();
        closeModal('orcamento');
        e.target.reset();
        document.getElementById('orc-data').value = new Date().toISOString().split('T')[0];
    } catch (err) {
        alert('Erro ao salvar: ' + err.message);
    }
}

async function deleteOrcamento(id) {
    if (!confirm('Excluir este item?')) return;
    try {
        await API.remove('orcamento', id);
        renderOrcamento();
    } catch (err) {
        alert('Erro ao excluir: ' + err.message);
    }
}

// ============= INVESTIMENTOS VIA API =============
let investimentosData = [];

async function renderInvestimentos() {
    const container = document.getElementById('investimentos-list');
    if (!API.isConfigured()) {
        container.innerHTML = '<p style="color:var(--text2);text-align:center">Configure a API no menu ⚙️ API</p>';
        return;
    }
    try {
        investimentosData = await API.list('investimentos');
    } catch {
        investimentosData = [];
    }

    const total = investimentosData.reduce((s, r) => s + (parseFloat(r.quantidade || 0) * parseFloat(r.preco_compra || 0)), 0);
    document.getElementById('inv-total').textContent = formatCurrency(total);
    document.getElementById('inv-qtd').textContent = investimentosData.length;

    if (!investimentosData.length) {
        container.innerHTML = '<p style="color:var(--text2);text-align:center">Nenhum investimento registrado</p>';
        return;
    }

    container.innerHTML = investimentosData.map(inv => {
        const totalInv = parseFloat(inv.quantidade) * parseFloat(inv.preco_compra);
        return `
            <div class="card" style="margin-bottom:16px">
                <div style="display:flex;justify-content:space-between;align-items:center">
                    <div>
                        <h3 style="margin:0">${esc(inv.ticker)}</h3>
                        <span style="font-size:12px;color:var(--text2)">${formatDate(inv.data_compra)}</span>
                    </div>
                    <div style="text-align:right">
                        <div style="font-size:18px;font-weight:700;color:var(--income)">${formatCurrency(totalInv)}</div>
                        <div style="font-size:12px;color:var(--text2)">${esc(inv.quantidade)} x ${formatCurrency(parseFloat(inv.preco_compra))}</div>
                    </div>
                </div>
                ${inv.comentarios ? `<div style="margin-top:12px;padding:12px;background:var(--bg3);border-radius:8px;font-size:13px;color:var(--text2)">💬 ${esc(inv.comentarios)}</div>` : ''}
                <div style="margin-top:12px;display:flex;gap:8px">
                    <button class="btn btn-sm btn-secondary" onclick="buscarTickerExistente('${esc(inv.ticker)}')">🔍 Pesquisar</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteInvestimento(${inv._id})">🗑️</button>
                </div>
            </div>
        `;
    }).join('');
}

async function addInvestimento(e) {
    e.preventDefault();
    if (!API.isConfigured()) { alert('Configure a API primeiro!'); return; }
    const ticker = document.getElementById('inv-ticker').value.toUpperCase().replace(/<[^>]*>/g, '');
    const qtd = parseInt(document.getElementById('inv-qtd').value);
    const preco = parseFloat(document.getElementById('inv-preco').value);
    if (!ticker || isNaN(qtd) || qtd <= 0 || isNaN(preco) || preco <= 0) return;
    try {
        await API.create('investimentos', {
            ticker,
            quantidade: qtd,
            preco_compra: preco,
            data_compra: document.getElementById('inv-data').value,
            comentarios: document.getElementById('inv-comentarios').value.replace(/<[^>]*>/g, ''),
            project: API.project
        });
        renderInvestimentos();
        closeModal('investimento');
        e.target.reset();
        document.getElementById('inv-data').value = new Date().toISOString().split('T')[0];
        document.getElementById('ticker-info').innerHTML = '';
    } catch (err) {
        alert('Erro ao salvar: ' + err.message);
    }
}

async function deleteInvestimento(id) {
    if (!confirm('Excluir este investimento?')) return;
    try {
        await API.remove('investimentos', id);
        renderInvestimentos();
    } catch (err) {
        alert('Erro ao excluir: ' + err.message);
    }
}

async function buscarTicker() {
    const ticker = document.getElementById('inv-ticker').value.toUpperCase().trim();
    if (!ticker) return;
    buscarTickerExistente(ticker);
}

async function buscarTickerExistente(ticker) {
    const info = document.getElementById('ticker-info');
    if (!info) return;
    info.innerHTML = 'Buscando...';
    try {
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.SA?range=1d&interval=1d`);
        const data = await res.json();
        const meta = data.chart?.result?.[0]?.meta;
        if (meta) {
            const price = meta.regularMarketPrice || meta.previousClose || 0;
            const name = meta.shortName || meta.longName || ticker;
            const currency = meta.currency || 'BRL';
            info.innerHTML = `
                <div style="padding:8px;background:var(--bg3);border-radius:8px">
                    <strong>${esc(name)}</strong> (${esc(ticker)})<br>
                    Preço atual: <strong style="color:var(--income)">${currency === 'BRL' ? 'R$' : '$'} ${price.toFixed(2)}</strong>
                </div>
            `;
        } else {
            info.innerHTML = '<span style="color:var(--warning)">Ticker não encontrado</span>';
        }
    } catch {
        info.innerHTML = '<span style="color:var(--danger)">Erro ao buscar ticker</span>';
    }
}

// ============= MODAIS =============
function openModal(type) {
    document.getElementById('modal-' + type).classList.add('active');
    if (type === 'api-config') loadApiConfigForm();
}

function closeModal(type) {
    document.getElementById('modal-' + type).classList.remove('active');
}

document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', e => {
        if (e.target === modal) {
            modal.classList.remove('active');
        }
    });
});

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
    }
});

function toggleSidebar() {
    document.getElementById('sidebar-overlay').classList.toggle('active');
    document.querySelector('.sidebar').classList.toggle('open');
}

function exportData() {
    const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'financeiro-dados.json';
    a.click();
    URL.revokeObjectURL(url);
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const imported = JSON.parse(e.target.result);
            if (imported.receitas && imported.despesas && imported.metas) {
                dados = imported;
                saveData();
                renderAll();
                alert('Dados importados com sucesso!');
            } else {
                alert('Arquivo inválido.');
            }
        } catch {
            alert('Erro ao ler arquivo.');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

function resetData() {
    if (confirm('Tem certeza? Todos os dados serão perdidos!')) {
        localStorage.removeItem('finance_data');
        dados = { receitas: [], despesas: [], metas: [], naos: [] };
        renderAll();
    }
}