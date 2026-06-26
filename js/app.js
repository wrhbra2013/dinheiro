let currentUser = null;
let currentAsset = 'geral';
let registerData = {};
let financialData = {};

document.addEventListener('DOMContentLoaded', async () => {
    await API.discover();
    const sessionId = API.getSession();
    if (sessionId) {
        currentUser = sessionId;
        showForum();
    } else {
        showAuth();
    }
    await renderSidebar();
    loadFinancialData();
    setupEnterKey();
    // Usuario editado manualmente não é sobrescrito pelo autocomplete
    document.getElementById('reg-usuario').addEventListener('input', function () {
        if (this.value.trim()) this.dataset.edited = 'true';
    });
    // Máscara de telefone +55 (xx) xxxxx-xxxx ao digitar
    const phoneInput = document.getElementById('reg-celular');
    phoneInput.addEventListener('input', function () {
        const caret = this.selectionStart || 0;
        const rawOld = this.value.slice(0, caret).replace(/\D/g, '').length;
        const digits = this.value.replace(/\D/g, '');
        const raw = (digits.startsWith('55') ? digits : '55' + digits).slice(0, 13);
        let fmt = '';
        if (raw.length > 2) {
            fmt = '+55 (' + raw.slice(2, 4);
            if (raw.length > 4) fmt += ') ' + raw.slice(4, 9);
            if (raw.length > 9) fmt += '-' + raw.slice(9, 13);
        } else {
            fmt = raw;
        }
        if (fmt === this.value) return;
        this.value = fmt;
        let c = -2;
        for (let i = 0; i < fmt.length; i++) {
            if (fmt[i] >= '0' && fmt[i] <= '9') c++;
            if (c >= rawOld) { this.setSelectionRange(i + 1, i + 1); return; }
        }
        this.setSelectionRange(fmt.length, fmt.length);
    });
});

function showAuth() {
    document.getElementById('auth-section').classList.add('active');
    document.getElementById('confirm-section').classList.remove('active');
    document.getElementById('forum-section').classList.remove('active');
}

function showConfirm() {
    document.getElementById('auth-section').classList.remove('active');
    document.getElementById('confirm-section').classList.add('active');
    document.getElementById('forum-section').classList.remove('active');
}

// ====== Modal system ======

let _modalResolve = null;

function closeModal() {
    document.getElementById('modal-overlay').classList.remove('active');
    if (_modalResolve) { _modalResolve(false); _modalResolve = null; }
}

function alertMsg(msg) {
    document.getElementById('modal-icon').textContent = 'ℹ️';
    document.getElementById('modal-title').textContent = 'Aviso';
    document.getElementById('modal-body').innerHTML = esc(msg);
    document.getElementById('modal-cancel').style.display = 'none';
    document.getElementById('modal-confirm').textContent = 'OK';
    document.getElementById('modal-overlay').classList.add('active');
    const btn = document.getElementById('modal-confirm');
    const handler = () => { closeModal(); btn.removeEventListener('click', handler); _modalResolve = null; };
    btn.addEventListener('click', handler);
}

function confirmMsg(msg) {
    return new Promise(resolve => {
        _modalResolve = resolve;
        document.getElementById('modal-icon').textContent = '⚠️';
        document.getElementById('modal-title').textContent = 'Confirmação';
        document.getElementById('modal-body').innerHTML = esc(msg);
        document.getElementById('modal-cancel').style.display = 'inline-block';
        document.getElementById('modal-confirm').textContent = 'Confirmar';
        document.getElementById('modal-overlay').classList.add('active');
        const confirmBtn = document.getElementById('modal-confirm');
        const cancelBtn = document.getElementById('modal-cancel');
        const cleanup = (val) => { closeModal(); _modalResolve = null; confirmBtn.removeEventListener('click', onConfirm); cancelBtn.removeEventListener('click', onCancel); resolve(val); };
        const onConfirm = () => cleanup(true);
        const onCancel = () => cleanup(false);
        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
    });
}

function autoFillUsuario() {
    const nome = document.getElementById('reg-nome').value.trim();
    const usuarioInput = document.getElementById('reg-usuario');
    if (!usuarioInput.dataset.edited) {
        usuarioInput.value = nome.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '');
    }
}

function showForum() {
    document.getElementById('auth-section').classList.remove('active');
    document.getElementById('confirm-section').classList.remove('active');
    document.getElementById('forum-section').classList.add('active');
    document.getElementById('user-name').textContent = currentUser.nome;
    document.getElementById('user-phone').textContent = '@' + (currentUser.usuario || '');
    document.getElementById('user-avatar').textContent = currentUser.nome.charAt(0).toUpperCase();
    const isMod = currentUser.role === 'moderator';
    document.getElementById('admin-panel').style.display = isMod ? 'block' : 'none';
    if (isMod) loadAdminForuns();
    selectAsset(currentAsset);
}

function toggleAuthTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    document.getElementById('auth-tab-' + tab).classList.add('active');
    document.getElementById('auth-form-' + tab).classList.add('active');
    document.getElementById('auth-error').textContent = '';
}

async function handleRegister(e) {
    e.preventDefault();
    const nome = document.getElementById('reg-nome').value.trim();
    const usuario = document.getElementById('reg-usuario').value.trim();
    let celular = document.getElementById('reg-celular').value.replace(/\D/g, '');
    if (celular.startsWith('55')) celular = celular.slice(2);
    if (!nome || !usuario || celular.length < 10) {
        document.getElementById('auth-error').textContent = 'Preencha nome, usuário e celular válidos';
        return;
    }
    const result = await API.register(nome, usuario, celular);
    if (result.error) {
        document.getElementById('auth-error').textContent = result.error;
        return;
    }
    registerData = { celular, code: result.code, userId: result.user?._id || result.user?.id };
    document.getElementById('confirm-phone').textContent = '+55 ' + celular.replace(/(\d{2})(\d{4,5})(\d{4})/, '($1) $2-$3');
    document.getElementById('confirm-code').value = '';
    document.getElementById('confirm-error').textContent = '';
    document.getElementById('confirm-sending').innerHTML = '<p>📱 Enviando código via WhatsApp...</p>';
    showConfirm();
    sendWhatsAppCode(celular, result.code);
}

async function sendWhatsAppCode(celular, code) {
    const el = document.getElementById('confirm-sending');
    const num = celular.replace(/\D/g, '');
    const msg = `Seu código de confirmação no InvestidoresClub é: ${code}`;
    const r = await API.sendWhatsApp(num, msg);
    if (r.error) {
        el.innerHTML = `<p>📱 Não foi possível enviar via WhatsApp. <button class="btn btn-sm btn-secondary" onclick="sendWhatsAppCode('${celular}', '${code}')">Tentar novamente</button></p>`;
        return;
    }
    el.innerHTML = `<p>✅ Código enviado para seu WhatsApp! <button class="btn btn-sm btn-secondary" onclick="sendWhatsAppCode('${celular}', '${code}')">Reenviar</button></p>`;
}

async function handleConfirm(e) {
    e.preventDefault();
    const code = document.getElementById('confirm-code').value.trim();
    if (!code) {
        document.getElementById('confirm-error').textContent = 'Digite o código recebido';
        return;
    }
    const result = await API.confirm(registerData.celular, code);
    if (result.error) {
        document.getElementById('confirm-error').textContent = result.error;
        return;
    }
    alertMsg('Cadastro confirmado! Sua senha são os 4 últimos dígitos do celular.');
    toggleAuthTab('login');
    document.getElementById('login-senha').value = '';
    showAuth();
}

async function handleLogin(e) {
    e.preventDefault();
    const usuario = document.getElementById('login-usuario').value.trim();
    const senha = document.getElementById('login-senha').value;
    if (!usuario || !senha) {
        document.getElementById('auth-error').textContent = 'Preencha usuário e senha';
        return;
    }
    const result = await API.login(usuario, senha);
    if (result.error) {
        document.getElementById('auth-error').textContent = result.error;
        return;
    }
    currentUser = result.user;
    showForum();
}

function handleLogout() {
    API.logout();
    currentUser = null;
    showAuth();
    document.getElementById('login-usuario').value = '';
    document.getElementById('login-senha').value = '';
}

async function renderSidebar() {
    const container = document.getElementById('sidebar-assets');
    let html = '';
    CATEGORIES.forEach((cat, ci) => {
        const items = ASSETS.filter(a => a.category === cat);
        const isFirst = ci === 0;
        html += `
            <div class="sidebar-category">
                <div class="sidebar-category-title ${isFirst ? 'expanded' : ''}" onclick="toggleCategory(this)">
                    <span>${cat}</span>
                    <span class="cat-arrow">${isFirst ? '▼' : '▶'}</span>
                </div>
                <div class="sidebar-items ${isFirst ? '' : 'collapsed'}">
                    ${items.map(a => `
                        <button class="sidebar-asset ${a.id === 'geral' ? 'active' : ''}" data-asset="${a.id}" onclick="selectAsset('${a.id}')">
                            <span>${a.icon}</span>
                            <span>${a.name}</span>
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
    });
    // Fóruns dinâmicos (criados por moderador)
    if (API.isConfigured()) {
        const foruns = await API.getForuns();
        if (foruns.length) {
            html += `
                <div class="sidebar-category">
                    <div class="sidebar-category-title expanded" onclick="toggleCategory(this)">
                        <span>Personalizado</span>
                        <span class="cat-arrow">▼</span>
                    </div>
                    <div class="sidebar-items">
                        ${foruns.map(f => `
                            <button class="sidebar-asset" data-asset="forum-${f._id}" onclick="selectAsset('forum-${f._id}')">
                                <span>${f.icone || '📁'}</span>
                                <span>${esc(f.nome)}</span>
                            </button>
                        `).join('')}
                    </div>
                </div>
            `;
        }
    }
    container.innerHTML = html;
}

function toggleCategory(el) {
    const items = el.nextElementSibling;
    const arrow = el.querySelector('.cat-arrow');
    const isCollapsed = items.classList.contains('collapsed');
    items.classList.toggle('collapsed');
    arrow.textContent = isCollapsed ? '▼' : '▶';
    el.classList.toggle('expanded');
}

async function selectAsset(assetId) {
    currentAsset = assetId;
    document.querySelectorAll('.sidebar-asset').forEach(b => {
        b.classList.toggle('active', b.dataset.asset === assetId);
    });
    const isDynamic = assetId.startsWith('forum-');
    let icon = '📁', name = assetId, category = 'Personalizado';
    if (isDynamic) {
        const foruns = await API.getForuns();
        const f = foruns.find(x => `forum-${x._id}` === assetId);
        if (f) { icon = f.icone || '📁'; name = f.nome; }
    } else {
        const asset = ASSETS.find(a => a.id === assetId);
        if (asset) { icon = asset.icon; name = asset.name; category = asset.category; }
    }
    document.getElementById('forum-title').textContent = `${icon} ${name}`;
    document.getElementById('forum-category').textContent = category;
    renderAssetData(assetId);
    document.getElementById('forum-posts').innerHTML = '<div class="forum-empty">Carregando mensagens...</div>';
    document.getElementById('forum-main').scrollTop = 0;
    const posts = await API.getMessages(assetId);
    renderPosts(posts);
}

function renderPosts(posts) {
    const container = document.getElementById('forum-posts');
    if (!posts || !posts.length) {
        container.innerHTML = '<div class="forum-empty">Nenhuma discussão ainda. Seja o primeiro a postar!</div>';
        return;
    }
    const isMod = currentUser && currentUser.role === 'moderator';
    container.innerHTML = posts.map(p => {
        const pid = p._id || p.id;
        const isMe = currentUser && (String(p.userId) === String(currentUser.id) || String(p.userId) === String(currentUser._id));
        const canDelete = isMod || isMe;
        const date = new Date(p.createdAt || p.createdat);
        const time = date.toLocaleString('pt-BR');
        const userName = p.userName || p.username || p.user_name || 'Anônimo';
        return `
            <div class="forum-post ${isMe ? 'my-post' : ''}">
                <div class="post-header">
                    <span class="post-author">${esc(userName)}</span>
                    <span class="post-time">${time}</span>
                    ${isMe ? '<span class="post-badge">Você</span>' : ''}
                    ${canDelete ? `<button class="btn-del" onclick="deletePost(${pid})" title="Excluir">✕</button>` : ''}
                </div>
                <div class="post-body">${esc(p.message || p.mensagem)}</div>
            </div>
        `;
    }).join('');
}

async function handlePost(e) {
    e.preventDefault();
    const input = document.getElementById('post-input');
    const msg = input.value.trim();
    if (!msg || !currentUser) return;
    await API.addPost(currentAsset, currentUser._id || currentUser.id, currentUser.nome, msg);
    input.value = '';
    const posts = await API.getMessages(currentAsset);
    renderPosts(posts);
}

function setupEnterKey() {
    document.getElementById('post-input').addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handlePost(e);
        }
    });
}

async function loadFinancialData() {
    const [selic, cdi, ipca, ibov] = await Promise.all([
        API.fetchSelic(), API.fetchCDI(), API.fetchIPCA(), API.fetchIbovespa()
    ]);
    financialData = { selic, cdi, ipca, ibov };
    updateMacroBar();
}

function updateMacroBar() {
    const d = financialData;
    if (d.selic) document.getElementById('macro-selic').textContent = d.selic.valor + '%';
    if (d.cdi) document.getElementById('macro-cdi').textContent = d.cdi.valor + '%';
    if (d.ipca) document.getElementById('macro-ipca').textContent = d.ipca.valor + '%';
    if (d.ibov) {
        const el = document.getElementById('macro-ibov');
        el.textContent = d.ibov.price.toFixed(0);
        el.style.color = d.ibov.change >= 0 ? 'var(--income)' : 'var(--expense)';
    }
}

async function renderAssetData(assetId) {
    const container = document.getElementById('asset-data');
    container.innerHTML = '<div class="asset-loading">Carregando dados...</div>';

    if (assetId.startsWith('forum-')) {
        container.innerHTML = '<div class="asset-info"><h4>📁 Fórum Personalizado</h4><p>Participe da discussão neste fórum.</p></div>';
        return;
    }
    switch (assetId) {
        case 'geral':
            container.innerHTML = `
                <div class="asset-welcome">
                    <h3>🐣 Bem-vindo ao InvestidoresClub!</h3>
                    <p>Use o fórum geral para discutir qualquer assunto sobre investimentos. Selecione um ativo específico na barra lateral para conversar com outros investidores sobre aquele tema.</p>
                    <div class="macro-cards">
                        <div class="macro-card"><span>Selic</span><strong id="macro-selic">${financialData.selic?.valor || '...'}%</strong></div>
                        <div class="macro-card"><span>CDI</span><strong id="macro-cdi">${financialData.cdi?.valor || '...'}%</strong></div>
                        <div class="macro-card"><span>IPCA</span><strong id="macro-ipca">${financialData.ipca?.valor || '...'}%</strong></div>
                        <div class="macro-card"><span>Ibovespa</span><strong id="macro-ibov">${financialData.ibov?.price?.toFixed(0) || '...'}</strong></div>
                    </div>
                </div>`;
            break;
        case 'cdi':
            container.innerHTML = `
                <div class="asset-info">
                    <h4>📊 CDI — Certificado de Depósito Interbancário</h4>
                    <p>Taxa que referencia a maioria dos investimentos de renda fixa. Acompanha de perto a Selic.</p>
                    <div class="macro-cards">
                        <div class="macro-card"><span>CDI Atual</span><strong>${financialData.cdi?.valor || '...'}%</strong></div>
                        <div class="macro-card"><span>Selic</span><strong>${financialData.selic?.valor || '...'}%</strong></div>
                    </div>
                </div>`;
            break;
        case 'cdb':
            container.innerHTML = `<div class="asset-info"><h4>🏦 CDB — Certificado de Depósito Bancário</h4><p>Título emitido por bancos. Rendimento atrelado ao CDI. Protegido pelo FGC até R$ 250 mil.</p></div>`; break;
        case 'lci':
            container.innerHTML = `<div class="asset-info"><h4>🏠 LCI — Letra de Crédito Imobiliário</h4><p>Título isento de IR. Lastreado em crédito imobiliário. Protegido pelo FGC.</p></div>`; break;
        case 'lca':
            container.innerHTML = `<div class="asset-info"><h4>🌾 LCA — Letra de Crédito do Agronegócio</h4><p>Título isento de IR. Lastreado em crédito do agronegócio. Protegido pelo FGC.</p></div>`; break;
        case 'lc':
            container.innerHTML = `<div class="asset-info"><h4>📄 LC — Letra de Câmbio</h4><p>Título emitido por financeiras. Semelhante ao CDB, com cobertura do FGC.</p></div>`; break;
        case 'cri':
            container.innerHTML = `<div class="asset-info"><h4>📋 CRI — Certificado de Recebíveis Imobiliários</h4><p>Título isento de IR. Sem cobertura do FGC.</p></div>`; break;
        case 'cra':
            container.innerHTML = `<div class="asset-info"><h4>📋 CRA — Certificado de Recebíveis do Agronegócio</h4><p>Título isento de IR. Sem cobertura do FGC.</p></div>`; break;
        case 'debentures':
            container.innerHTML = `<div class="asset-info"><h4>📜 Debêntures</h4><p>Títulos de dívida emitidos por empresas. Podem ser incentivadas (isentas de IR) ou comuns.</p></div>`; break;
        case 'lf':
            container.innerHTML = `<div class="asset-info"><h4>💰 LF — Letra Financeira</h4><p>Título de grandes bancos com prazo mínimo de 2 anos. Investimento mínimo elevado. Protegido pelo FGC.</p></div>`; break;
        case 'poupanca':
            container.innerHTML = `
                <div class="asset-info">
                    <h4>🐖 Poupança</h4>
                    <p>Rendimento de 0,5% a.m. + TR (Selic > 8,5%). Isenta de IR.</p>
                    <div class="macro-cards">
                        <div class="macro-card"><span>Rendimento</span><strong>0,5% a.m.</strong></div>
                    </div>
                </div>`; break;
        case 'tesouro-selic':
            container.innerHTML = `
                <div class="asset-info"><h4>🇧🇷 Tesouro Selic</h4><p>Título público pós-fixado. Ideal para reserva de emergência. Liquidez diária.</p>
                    <div class="macro-cards"><div class="macro-card"><span>Selic</span><strong>${financialData.selic?.valor || '...'}%</strong></div></div>
                </div>`; break;
        case 'tesouro-prefixado':
            container.innerHTML = `<div class="asset-info"><h4>📈 Tesouro Prefixado</h4><p>Título público com taxa fixa definida na compra. Ideal para apostar em queda de juros.</p></div>`; break;
        case 'tesouro-ipca':
            container.innerHTML = `
                <div class="asset-info"><h4>📊 Tesouro IPCA+</h4><p>Rende IPCA + taxa real. Ideal para longo prazo e proteção contra inflação.</p>
                    <div class="macro-cards"><div class="macro-card"><span>IPCA</span><strong>${financialData.ipca?.valor || '...'}%</strong></div></div>
                </div>`; break;
        case 'acoes': {
            container.innerHTML = `<div class="asset-info"><h4>📈 Ações</h4><p>Frações do capital social de empresas na B3.</p></div><div class="quote-list" id="quote-list"><div class="asset-loading">Carregando cotações...</div></div>`;
            const at = ['PETR4','VALE3','ITUB4','MGLU3','BBDC4','ABEV3','WEGE3'];
            Promise.all(at.map(t => API.fetchQuote(t))).then(r => {
                const div = document.getElementById('quote-list');
                const v = r.filter(x => x);
                if (!v.length) { div.innerHTML = '<p style="color:var(--text2)">Indisponível</p>'; return; }
                div.innerHTML = v.map(q => `<div class="quote-item"><span class="quote-ticker">${q.ticker}</span><span class="quote-name">${esc(q.name)}</span><span class="quote-price">R$ ${q.price.toFixed(2)}</span><span class="quote-change ${q.change>=0?'up':'down'}">${q.change>=0?'+':''}${q.change}%</span></div>`).join('');
            }); break;
        }
        case 'fiis': {
            container.innerHTML = `<div class="asset-info"><h4>🏢 FIIs — Fundos Imobiliários</h4><p>Fundos que investem em imóveis. Rendimentos mensais isentos de IR.</p></div><div class="quote-list" id="quote-list"><div class="asset-loading">Carregando cotações...</div></div>`;
            Promise.all(['KNRI11','HGLG11','XPLG11','MXRF11','BCFF11','VISC11'].map(t => API.fetchQuote(t))).then(r => {
                const div = document.getElementById('quote-list');
                const v = r.filter(x => x);
                if (!v.length) { div.innerHTML = '<p style="color:var(--text2)">Indisponível</p>'; return; }
                div.innerHTML = v.map(q => `<div class="quote-item"><span class="quote-ticker">${q.ticker}</span><span class="quote-name">${esc(q.name)}</span><span class="quote-price">R$ ${q.price.toFixed(2)}</span><span class="quote-change ${q.change>=0?'up':'down'}">${q.change>=0?'+':''}${q.change}%</span></div>`).join('');
            }); break;
        }
        case 'etfs': {
            container.innerHTML = `<div class="asset-info"><h4>📊 ETFs — Exchange Traded Funds</h4><p>Fundos que replicam índices. Negociados em bolsa.</p></div><div class="quote-list" id="quote-list"><div class="asset-loading">Carregando cotações...</div></div>`;
            Promise.all(['BOVA11','IVVB11','SMAL11'].map(t => API.fetchQuote(t))).then(r => {
                const div = document.getElementById('quote-list');
                const v = r.filter(x => x);
                if (!v.length) { div.innerHTML = '<p style="color:var(--text2)">Indisponível</p>'; return; }
                div.innerHTML = v.map(q => `<div class="quote-item"><span class="quote-ticker">${q.ticker}</span><span class="quote-name">${esc(q.name)}</span><span class="quote-price">R$ ${q.price.toFixed(2)}</span><span class="quote-change ${q.change>=0?'up':'down'}">${q.change>=0?'+':''}${q.change}%</span></div>`).join('');
            }); break;
        }
        case 'bdrs': {
            container.innerHTML = `<div class="asset-info"><h4>🌎 BDRs — Brazilian Depositary Receipts</h4><p>Ações de empresas estrangeiras negociadas na B3.</p></div><div class="quote-list" id="quote-list"><div class="asset-loading">Carregando cotações...</div></div>`;
            Promise.all(['AAPL34','GOOG34','MSFT34','AMZO34'].map(t => API.fetchQuote(t))).then(r => {
                const div = document.getElementById('quote-list');
                const v = r.filter(x => x);
                if (!v.length) { div.innerHTML = '<p style="color:var(--text2)">Indisponível</p>'; return; }
                div.innerHTML = v.map(q => `<div class="quote-item"><span class="quote-ticker">${q.ticker}</span><span class="quote-name">${esc(q.name)}</span><span class="quote-price">R$ ${q.price.toFixed(2)}</span><span class="quote-change ${q.change>=0?'up':'down'}">${q.change>=0?'+':''}${q.change}%</span></div>`).join('');
            }); break;
        }
        case 'indices': {
            container.innerHTML = `<div class="asset-info"><h4>📉 Índices</h4><p>Ibovespa, IFIX, S&P 500 — referência para performance.</p></div><div class="quote-list" id="quote-list"><div class="asset-loading">Carregando...</div></div>`;
            Promise.all([API.fetchIbovespa(), API.fetchQuote('IFIX')]).then(([ibov, ifix]) => {
                const div = document.getElementById('quote-list');
                let h = '';
                if (ibov) h += `<div class="quote-item"><span class="quote-ticker">IBOV</span><span class="quote-name">Ibovespa</span><span class="quote-price">${ibov.price.toFixed(0)}</span><span class="quote-change ${ibov.change>=0?'up':'down'}">${ibov.change>=0?'+':''}${ibov.change}%</span></div>`;
                if (ifix) h += `<div class="quote-item"><span class="quote-ticker">IFIX</span><span class="quote-name">${esc(ifix.name)}</span><span class="quote-price">${ifix.price.toFixed(0)}</span><span class="quote-change ${ifix.change>=0?'up':'down'}">${ifix.change>=0?'+':''}${ifix.change}%</span></div>`;
                div.innerHTML = h || '<p style="color:var(--text2)">Indisponível</p>';
            }); break;
        }
        case 'derivativos':
            container.innerHTML = `<div class="asset-info"><h4>⚡ Derivativos</h4><p>Opções, Futuros, SWAPs. Alto risco e alavancagem.</p></div>`; break;
        case 'fundos':
            container.innerHTML = `<div class="asset-info"><h4>📁 Fundos de Investimento</h4><p>Multimercado, ações, renda fixa, cambiais. Gestão profissional.</p></div>`; break;
        case 'bitcoin': {
            container.innerHTML = `<div class="asset-info"><h4>₿ Bitcoin</h4><p>Primeira criptomoeda. Oferta limitada a 21 milhões.</p></div><div class="quote-list" id="quote-list"><div class="asset-loading">Carregando...</div></div>`;
            API.fetchCrypto('BTC').then(q => {
                const div = document.getElementById('quote-list');
                if (!q) { div.innerHTML = '<p style="color:var(--text2)">Indisponível</p>'; return; }
                div.innerHTML = `<div class="quote-item"><span class="quote-ticker">BTC</span><span class="quote-name">Bitcoin</span><span class="quote-price">$ ${q.price.toLocaleString('en-US',{minimumFractionDigits:2})}</span><span class="quote-change ${q.change>=0?'up':'down'}">${q.change>=0?'+':''}${q.change}%</span></div>`;
            }); break;
        }
        case 'altcoins': {
            container.innerHTML = `<div class="asset-info"><h4>🪙 Altcoins</h4><p>Ethereum, Solana, Cardano, Chainlink e outras.</p></div><div class="quote-list" id="quote-list"><div class="asset-loading">Carregando...</div></div>`;
            Promise.all(['ETH','SOL','ADA','LINK'].map(t => API.fetchCrypto(t))).then(r => {
                const div = document.getElementById('quote-list');
                const v = r.filter(x => x);
                if (!v.length) { div.innerHTML = '<p style="color:var(--text2)">Indisponível</p>'; return; }
                div.innerHTML = v.map(q => `<div class="quote-item"><span class="quote-ticker">${q.ticker}</span><span class="quote-name">${esc(q.name)}</span><span class="quote-price">$ ${q.price.toLocaleString('en-US',{minimumFractionDigits:2})}</span><span class="quote-change ${q.change>=0?'up':'down'}">${q.change>=0?'+':''}${q.change}%</span></div>`).join('');
            }); break;
        }
        case 'stablecoins': {
            container.innerHTML = `<div class="asset-info"><h4>💲 Stablecoins</h4><p>USDT, USDC, DAI — atreladas 1:1 ao dólar.</p></div><div class="quote-list" id="quote-list"><div class="asset-loading">Carregando...</div></div>`;
            Promise.all(['USDT','USDC','DAI'].map(t => API.fetchCrypto(t))).then(r => {
                const div = document.getElementById('quote-list');
                const v = r.filter(x => x && x.price > 0.9);
                if (!v.length) { div.innerHTML = '<p style="color:var(--text2)">Indisponível</p>'; return; }
                div.innerHTML = v.map(q => `<div class="quote-item"><span class="quote-ticker">${q.ticker}</span><span class="quote-name">${esc(q.name)}</span><span class="quote-price">$ ${q.price.toFixed(4)}</span><span class="quote-change ${q.change>=0?'up':'down'}">${q.change>=0?'+':''}${q.change}%</span></div>`).join('');
            }); break;
        }
    }
}

async function deletePost(id) {
    const ok = await confirmMsg('Excluir mensagem?');
    if (!ok) return;
    const r = await API.deleteMessage(id);
    if (r.error) { alertMsg(r.error); return; }
    const posts = await API.getMessages(currentAsset);
    renderPosts(posts);
}

function toggleAdmin() {
    const body = document.getElementById('admin-body');
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
    if (body.style.display === 'block') loadAdminForuns();
}

async function loadAdminForuns() {
    const list = document.getElementById('admin-foruns-list');
    list.innerHTML = '<small>Carregando...</small>';
    const foruns = await API.getForuns();
    if (!foruns.length) { list.innerHTML = '<small>Nenhum fórum personalizado</small>'; return; }
    list.innerHTML = foruns.map(f => `
        <div class="admin-forum-item">
            <span>${f.icone || '📁'} ${esc(f.nome)}</span>
            <button class="btn-del" onclick="deleteForum(${f._id})" title="Excluir">✕</button>
        </div>
    `).join('');
}

async function handleCreateForum(e) {
    e.preventDefault();
    const nome = document.getElementById('admin-forum-nome').value.trim();
    const icone = document.getElementById('admin-forum-icone').value.trim() || '📁';
    const descricao = document.getElementById('admin-forum-descricao').value.trim();
    const r = await API.createForum(nome, icone, descricao, 'Personalizado');
    if (r.error) { alertMsg(r.error); return; }
    document.getElementById('admin-forum-nome').value = '';
    document.getElementById('admin-forum-descricao').value = '';
    loadAdminForuns();
    renderSidebar();
}

async function deleteForum(id) {
    const ok = await confirmMsg('Excluir este fórum e todas as suas mensagens?');
    if (!ok) return;
    const r = await API.deleteForum(id);
    if (r.error) { alertMsg(r.error); return; }
    loadAdminForuns();
    renderSidebar();
    if (document.querySelector(`[data-asset="forum-${id}"]`)) selectAsset('geral');
}

function toggleSidebar() {
    document.querySelector('.sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('active');
}
