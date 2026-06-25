let currentUser = null;
let currentAsset = 'geral';
let registerData = {};
let financialData = {};
let postsCache = {};

document.addEventListener('DOMContentLoaded', async () => {
    currentUser = API.getSession();
    if (currentUser) {
        showForum();
    } else {
        showAuth();
    }
    renderSidebar();
    loadFinancialData();
    setupEnterKey();
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

function showForum() {
    document.getElementById('auth-section').classList.remove('active');
    document.getElementById('confirm-section').classList.remove('active');
    document.getElementById('forum-section').classList.add('active');
    document.getElementById('user-name').textContent = currentUser.nome;
    document.getElementById('user-phone').textContent = currentUser.celular.replace(/(\d{2})(\d{4,5})(\d{4})/, '($1) $2-$3');
    document.getElementById('user-avatar').textContent = currentUser.nome.charAt(0).toUpperCase();
    selectAsset(currentAsset);
}

function toggleAuthTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    document.getElementById('auth-tab-' + tab).classList.add('active');
    document.getElementById('auth-form-' + tab).classList.add('active');
    document.getElementById('auth-error').textContent = '';
}

function handleRegister(e) {
    e.preventDefault();
    const nome = document.getElementById('reg-nome').value.trim();
    const celular = document.getElementById('reg-celular').value.replace(/\D/g, '');
    if (!nome || celular.length < 10) {
        document.getElementById('auth-error').textContent = 'Preencha nome e celular válidos';
        return;
    }
    const result = API.register(nome, celular);
    if (result.error) {
        document.getElementById('auth-error').textContent = result.error;
        return;
    }
    registerData = { celular, code: result.code };
    document.getElementById('confirm-phone').textContent = celular.replace(/(\d{2})(\d{4,5})(\d{4})/, '($1) $2-$3');
    document.getElementById('confirm-code-display').textContent = result.code;
    document.getElementById('confirm-code').value = '';
    document.getElementById('confirm-error').textContent = '';
    showConfirm();
}

function resendCode() {
    document.getElementById('confirm-code-display').textContent = registerData.code;
    document.getElementById('confirm-error').textContent = 'Código reenviado via WhatsApp (simulado)';
}

function handleConfirm(e) {
    e.preventDefault();
    const code = document.getElementById('confirm-code').value.trim();
    if (!code) {
        document.getElementById('confirm-error').textContent = 'Digite o código recebido';
        return;
    }
    const result = API.confirm(registerData.celular, code);
    if (result.error) {
        document.getElementById('confirm-error').textContent = result.error;
        return;
    }
    alert('✅ Cadastro confirmado! Sua senha são os 4 últimos dígitos do celular.');
    toggleAuthTab('login');
    document.getElementById('login-celular').value = registerData.celular;
    showAuth();
}

function handleLogin(e) {
    e.preventDefault();
    const celular = document.getElementById('login-celular').value.replace(/\D/g, '');
    const senha = document.getElementById('login-senha').value;
    if (!celular || !senha) {
        document.getElementById('auth-error').textContent = 'Preencha celular e senha';
        return;
    }
    const result = API.login(celular, senha);
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
    document.getElementById('login-celular').value = '';
    document.getElementById('login-senha').value = '';
}

function renderSidebar() {
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

function selectAsset(assetId) {
    currentAsset = assetId;
    document.querySelectorAll('.sidebar-asset').forEach(b => {
        b.classList.toggle('active', b.dataset.asset === assetId);
    });
    const asset = ASSETS.find(a => a.id === assetId);
    document.getElementById('forum-title').textContent = `${asset.icon} ${asset.name}`;
    document.getElementById('forum-category').textContent = asset.category;
    renderPosts(assetId);
    renderAssetData(assetId);
    document.getElementById('forum-main').scrollTop = 0;
}

function renderPosts(assetId) {
    const container = document.getElementById('forum-posts');
    const posts = API.getPosts(assetId);
    if (!posts.length) {
        container.innerHTML = '<div class="forum-empty">Nenhuma discussão ainda. Seja o primeiro a postar!</div>';
        return;
    }
    container.innerHTML = posts.map(p => {
        const isMe = currentUser && p.userId === currentUser.id;
        const date = new Date(p.createdAt);
        const time = date.toLocaleString('pt-BR');
        return `
            <div class="forum-post ${isMe ? 'my-post' : ''}">
                <div class="post-header">
                    <span class="post-author">${esc(p.userName)}</span>
                    <span class="post-time">${time}</span>
                    ${isMe ? '<span class="post-badge">Você</span>' : ''}
                </div>
                <div class="post-body">${esc(p.message)}</div>
            </div>
        `;
    }).join('');
}

function handlePost(e) {
    e.preventDefault();
    const input = document.getElementById('post-input');
    const msg = input.value.trim();
    if (!msg) return;
    API.addPost(currentAsset, currentUser.id, currentUser.nome, msg);
    input.value = '';
    renderPosts(currentAsset);
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
        API.fetchSelic(),
        API.fetchCDI(),
        API.fetchIPCA(),
        API.fetchIbovespa()
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

    switch (assetId) {
        case 'geral':
            container.innerHTML = `
                <div class="asset-welcome">
                    <h3>🐣 Bem-vindo ao Clube de Investidores!</h3>
                    <p>Use o fórum geral para discutir qualquer assunto sobre investimentos. Selecione um ativo específico na barra lateral para conversar com outros investidores sobre aquele tema.</p>
                    <div class="macro-cards">
                        <div class="macro-card"><span>Selic</span><strong id="macro-selic">${financialData.selic?.valor || '...'}%</strong></div>
                        <div class="macro-card"><span>CDI</span><strong id="macro-cdi">${financialData.cdi?.valor || '...'}%</strong></div>
                        <div class="macro-card"><span>IPCA</span><strong id="macro-ipca">${financialData.ipca?.valor || '...'}%</strong></div>
                        <div class="macro-card"><span>Ibovespa</span><strong id="macro-ibov">${financialData.ibov?.price?.toFixed(0) || '...'}</strong></div>
                    </div>
                </div>
            `;
            break;
        case 'cdi':
            container.innerHTML = `
                <div class="asset-info">
                    <h4>📊 CDI — Certificado de Depósito Interbancário</h4>
                    <p>Taxa que referencia a maioria dos investimentos de renda fixa no Brasil. Acompanha de perto a Selic.</p>
                    <div class="macro-cards">
                        <div class="macro-card"><span>CDI Atual</span><strong>${financialData.cdi?.valor || '...'}%</strong></div>
                        <div class="macro-card"><span>Selic</span><strong>${financialData.selic?.valor || '...'}%</strong></div>
                    </div>
                </div>
            `;
            break;
        case 'cdb':
            container.innerHTML = `
                <div class="asset-info">
                    <h4>🏦 CDB — Certificado de Depósito Bancário</h4>
                    <p>Título emitido por bancos para captar recursos. Rendimento atrelado ao CDI. Protegido pelo FGC até R$ 250 mil.</p>
                </div>
            `;
            break;
        case 'lci':
            container.innerHTML = `
                <div class="asset-info">
                    <h4>🏠 LCI — Letra de Crédito Imobiliário</h4>
                    <p>Título isento de IR lastreado em crédito imobiliário. Rendimento atrelado ao CDI. Protegido pelo FGC.</p>
                </div>
            `;
            break;
        case 'lca':
            container.innerHTML = `
                <div class="asset-info">
                    <h4>🌾 LCA — Letra de Crédito do Agronegócio</h4>
                    <p>Título isento de IR lastreado em crédito do agronegócio. Rendimento atrelado ao CDI. Protegido pelo FGC.</p>
                </div>
            `;
            break;
        case 'lc':
            container.innerHTML = `
                <div class="asset-info">
                    <h4>📄 LC — Letra de Câmbio</h4>
                    <p>Título emitido por financeiras (SFH). Semelhante ao CDB, com cobertura do FGC.</p>
                </div>
            `;
            break;
        case 'cri':
            container.innerHTML = `
                <div class="asset-info">
                    <h4>📋 CRI — Certificado de Recebíveis Imobiliários</h4>
                    <p>Título isento de IR lastreado em recebíveis imobiliários. Sem cobertura do FGC.</p>
                </div>
            `;
            break;
        case 'cra':
            container.innerHTML = `
                <div class="asset-info">
                    <h4>📋 CRA — Certificado de Recebíveis do Agronegócio</h4>
                    <p>Título isento de IR lastreado em recebíveis do agronegócio. Sem cobertura do FGC.</p>
                </div>
            `;
            break;
        case 'debentures':
            container.innerHTML = `
                <div class="asset-info">
                    <h4>📜 Debêntures</h4>
                    <p>Títulos de dívida emitidos por empresas. Podem ser incentivadas (isentas de IR) ou comuns. Sem cobertura do FGC.</p>
                </div>
            `;
            break;
        case 'lf':
            container.innerHTML = `
                <div class="asset-info">
                    <h4>💰 LF — Letra Financeira</h4>
                    <p>Título emitido por grandes bancos com prazo mínimo de 2 anos. Investimento mínimo elevado. Protegido pelo FGC.</p>
                </div>
            `;
            break;
        case 'poupanca':
            container.innerHTML = `
                <div class="asset-info">
                    <h4>🐖 Poupança</h4>
                    <p>Investimento mais popular do Brasil. Rendimento de 0,5% a.m. + TR (quando Selic > 8,5%). Isenta de IR.</p>
                    <div class="macro-cards">
                        <div class="macro-card"><span>Rendimento</span><strong>0,5% a.m.</strong></div>
                        <div class="macro-card"><span>TR Atual</span><strong id="poupanca-tr">${financialData.selic?.valor ? parseFloat(financialData.selic.valor) > 8.5 ? '0,00%' : '...' : '...'}</strong></div>
                    </div>
                </div>
            `;
            break;
        case 'tesouro-selic':
            container.innerHTML = `
                <div class="asset-info">
                    <h4>🇧🇷 Tesouro Selic</h4>
                    <p>Título público pós-fixado que acompanha a taxa Selic. Ideal para reserva de emergência. Liquidez diária.</p>
                    <div class="macro-cards">
                        <div class="macro-card"><span>Selic</span><strong>${financialData.selic?.valor || '...'}%</strong></div>
                    </div>
                </div>
            `;
            break;
        case 'tesouro-prefixado':
            container.innerHTML = `
                <div class="asset-info">
                    <h4>📈 Tesouro Prefixado</h4>
                    <p>Título público com taxa fixa definida no momento da compra. Ideal para apostar em queda de juros.</p>
                </div>
            `;
            break;
        case 'tesouro-ipca':
            container.innerHTML = `
                <div class="asset-info">
                    <h4>📊 Tesouro IPCA+</h4>
                    <p>Título público que rende IPCA + taxa real. Ideal para longo prazo e proteção contra inflação.</p>
                    <div class="macro-cards">
                        <div class="macro-card"><span>IPCA</span><strong>${financialData.ipca?.valor || '...'}%</strong></div>
                    </div>
                </div>
            `;
            break;
        case 'acoes': {
            container.innerHTML = `
                <div class="asset-info">
                    <h4>📈 Ações</h4>
                    <p>Frações do capital social de empresas listadas na B3. Direito a dividendos e voto.</p>
                </div>
                <div class="quote-list" id="quote-list"><div class="asset-loading">Carregando cotações...</div></div>
            `;
            const tickers = ['PETR4', 'VALE3', 'ITUB4', 'MGLU3', 'BBDC4', 'ABEV3', 'WEGE3'];
            Promise.all(tickers.map(t => API.fetchQuote(t))).then(results => {
                const div = document.getElementById('quote-list');
                const valid = results.filter(r => r);
                if (!valid.length) { div.innerHTML = '<p style="color:var(--text2)">Cotações indisponíveis</p>'; return; }
                div.innerHTML = valid.map(q => `
                    <div class="quote-item">
                        <span class="quote-ticker">${q.ticker}</span>
                        <span class="quote-name">${esc(q.name)}</span>
                        <span class="quote-price">R$ ${q.price.toFixed(2)}</span>
                        <span class="quote-change ${q.change >= 0 ? 'up' : 'down'}">${q.change >= 0 ? '+' : ''}${q.change}%</span>
                    </div>
                `).join('');
            });
            break;
        }
        case 'fiis': {
            container.innerHTML = `
                <div class="asset-info">
                    <h4>🏢 FIIs — Fundos de Investimento Imobiliário</h4>
                    <p>Fundos que investem em imóveis ou títulos imobiliários. Distribuem rendimentos mensais isentos de IR para PF.</p>
                </div>
                <div class="quote-list" id="quote-list"><div class="asset-loading">Carregando cotações...</div></div>
            `;
            const tickers = ['KNRI11', 'HGLG11', 'XPLG11', 'MXRF11', 'BCFF11', 'VISC11'];
            Promise.all(tickers.map(t => API.fetchQuote(t))).then(results => {
                const div = document.getElementById('quote-list');
                const valid = results.filter(r => r);
                if (!valid.length) { div.innerHTML = '<p style="color:var(--text2)">Cotações indisponíveis</p>'; return; }
                div.innerHTML = valid.map(q => `
                    <div class="quote-item">
                        <span class="quote-ticker">${q.ticker}</span>
                        <span class="quote-name">${esc(q.name)}</span>
                        <span class="quote-price">R$ ${q.price.toFixed(2)}</span>
                        <span class="quote-change ${q.change >= 0 ? 'up' : 'down'}">${q.change >= 0 ? '+' : ''}${q.change}%</span>
                    </div>
                `).join('');
            });
            break;
        }
        case 'etfs':
            container.innerHTML = `
                <div class="asset-info">
                    <h4>📊 ETFs — Exchange Traded Funds</h4>
                    <p>Fundos que replicam índices (como BOVA11, IVVB11). Negociados em bolsa como ações. Taxas baixas.</p>
                </div>
                <div class="quote-list" id="quote-list"><div class="asset-loading">Carregando cotações...</div></div>
            `;
            Promise.all(['BOVA11', 'IVVB11', 'SMAL11'].map(t => API.fetchQuote(t))).then(results => {
                const div = document.getElementById('quote-list');
                const valid = results.filter(r => r);
                if (!valid.length) { div.innerHTML = '<p style="color:var(--text2)">Cotações indisponíveis</p>'; return; }
                div.innerHTML = valid.map(q => `
                    <div class="quote-item">
                        <span class="quote-ticker">${q.ticker}</span>
                        <span class="quote-name">${esc(q.name)}</span>
                        <span class="quote-price">R$ ${q.price.toFixed(2)}</span>
                        <span class="quote-change ${q.change >= 0 ? 'up' : 'down'}">${q.change >= 0 ? '+' : ''}${q.change}%</span>
                    </div>
                `).join('');
            });
            break;
        case 'bdrs':
            container.innerHTML = `
                <div class="asset-info">
                    <h4>🌎 BDRs — Brazilian Depositary Receipts</h4>
                    <p>Certificados que representam ações de empresas estrangeiras negociadas na B3. Exposição internacional sem sair do Brasil.</p>
                </div>
                <div class="quote-list" id="quote-list"><div class="asset-loading">Carregando cotações...</div></div>
            `;
            Promise.all(['AAPL34', 'GOOG34', 'MSFT34', 'AMZO34'].map(t => API.fetchQuote(t))).then(results => {
                const div = document.getElementById('quote-list');
                const valid = results.filter(r => r);
                if (!valid.length) { div.innerHTML = '<p style="color:var(--text2)">Cotações indisponíveis</p>'; return; }
                div.innerHTML = valid.map(q => `
                    <div class="quote-item">
                        <span class="quote-ticker">${q.ticker}</span>
                        <span class="quote-name">${esc(q.name)}</span>
                        <span class="quote-price">R$ ${q.price.toFixed(2)}</span>
                        <span class="quote-change ${q.change >= 0 ? 'up' : 'down'}">${q.change >= 0 ? '+' : ''}${q.change}%</span>
                    </div>
                `).join('');
            });
            break;
        case 'indices':
            container.innerHTML = `
                <div class="asset-info">
                    <h4>📉 Índices</h4>
                    <p>Indicadores do mercado: Ibovespa, IFIX, S&P 500, etc. Referência para performance da carteira.</p>
                </div>
                <div class="quote-list" id="quote-list"><div class="asset-loading">Carregando...</div></div>
            `;
            Promise.all([
                API.fetchIbovespa(),
                API.fetchQuote('IFIX')
            ]).then(([ibov, ifix]) => {
                const div = document.getElementById('quote-list');
                let html = '';
                if (ibov) html += `
                    <div class="quote-item">
                        <span class="quote-ticker">IBOV</span>
                        <span class="quote-name">Ibovespa</span>
                        <span class="quote-price">${ibov.price.toFixed(0)}</span>
                        <span class="quote-change ${ibov.change >= 0 ? 'up' : 'down'}">${ibov.change >= 0 ? '+' : ''}${ibov.change}%</span>
                    </div>`;
                if (ifix) html += `
                    <div class="quote-item">
                        <span class="quote-ticker">IFIX</span>
                        <span class="quote-name">${esc(ifix.name)}</span>
                        <span class="quote-price">${ifix.price.toFixed(0)}</span>
                        <span class="quote-change ${ifix.change >= 0 ? 'up' : 'down'}">${ifix.change >= 0 ? '+' : ''}${ifix.change}%</span>
                    </div>`;
                div.innerHTML = html || '<p style="color:var(--text2)">Indisponível</p>';
            });
            break;
        case 'derivativos':
            container.innerHTML = `
                <div class="asset-info">
                    <h4>⚡ Derivativos</h4>
                    <p>Opções, Futuros, SWAPs. Instrumentos financeiros cujo valor deriva de um ativo subjacente. Alto risco e alavancagem.</p>
                </div>
            `;
            break;
        case 'fundos':
            container.innerHTML = `
                <div class="asset-info">
                    <h4>📁 Fundos de Investimento</h4>
                    <p>Fundos multimercado, de ações, renda fixa, cambiais. Gestão profissional com taxa de administração.</p>
                </div>
            `;
            break;
        case 'bitcoin':
            container.innerHTML = `
                <div class="asset-info">
                    <h4>₿ Bitcoin</h4>
                    <p>Primeira e maior criptomoeda do mundo. Descentralizada, oferta limitada a 21 milhões.</p>
                </div>
                <div class="quote-list" id="quote-list"><div class="asset-loading">Carregando cotação...</div></div>
            `;
            API.fetchCrypto('BTC').then(q => {
                const div = document.getElementById('quote-list');
                if (!q) { div.innerHTML = '<p style="color:var(--text2)">Cotação indisponível</p>'; return; }
                div.innerHTML = `
                    <div class="quote-item">
                        <span class="quote-ticker">BTC</span>
                        <span class="quote-name">Bitcoin</span>
                        <span class="quote-price">$ ${q.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                        <span class="quote-change ${q.change >= 0 ? 'up' : 'down'}">${q.change >= 0 ? '+' : ''}${q.change}%</span>
                    </div>`;
            });
            break;
        case 'altcoins':
            container.innerHTML = `
                <div class="asset-info">
                    <h4>🪙 Altcoins</h4>
                    <p>Criptomoedas alternativas ao Bitcoin: Ethereum (ETH), Solana (SOL), Cardano (ADA), Chainlink (LINK) e milhares de outras.</p>
                </div>
                <div class="quote-list" id="quote-list"><div class="asset-loading">Carregando cotações...</div></div>
            `;
            Promise.all(['ETH', 'SOL', 'ADA', 'LINK'].map(t => API.fetchCrypto(t))).then(results => {
                const div = document.getElementById('quote-list');
                const valid = results.filter(r => r);
                if (!valid.length) { div.innerHTML = '<p style="color:var(--text2)">Cotações indisponíveis</p>'; return; }
                div.innerHTML = valid.map(q => `
                    <div class="quote-item">
                        <span class="quote-ticker">${q.ticker}</span>
                        <span class="quote-name">${esc(q.name)}</span>
                        <span class="quote-price">$ ${q.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                        <span class="quote-change ${q.change >= 0 ? 'up' : 'down'}">${q.change >= 0 ? '+' : ''}${q.change}%</span>
                    </div>
                `).join('');
            });
            break;
        case 'stablecoins':
            container.innerHTML = `
                <div class="asset-info">
                    <h4>💲 Stablecoins</h4>
                    <p>Criptomoedas atreladas a ativos estáveis (USDT, USDC, DAI). Paridade 1:1 com o dólar americano. Usadas como reserva de valor digital.</p>
                </div>
                <div class="quote-list" id="quote-list"><div class="asset-loading">Carregando cotações...</div></div>
            `;
            const stables = [['USDT', 'Tether'], ['USDC', 'USD Coin'], ['DAI', 'Dai']];
            Promise.all(stables.map(([t]) => API.fetchCrypto(t))).then(results => {
                const div = document.getElementById('quote-list');
                const valid = results.filter(r => r && r.price > 0.9);
                if (!valid.length) { div.innerHTML = '<p style="color:var(--text2)">Cotações indisponíveis</p>'; return; }
                div.innerHTML = valid.map(q => `
                    <div class="quote-item">
                        <span class="quote-ticker">${q.ticker}</span>
                        <span class="quote-name">${esc(q.name)}</span>
                        <span class="quote-price">$ ${q.price.toFixed(4)}</span>
                        <span class="quote-change ${q.change >= 0 ? 'up' : 'down'}">${q.change >= 0 ? '+' : ''}${q.change}%</span>
                    </div>
                `).join('');
            });
            break;
    }
}

function toggleSidebar() {
    document.querySelector('.sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('active');
}
