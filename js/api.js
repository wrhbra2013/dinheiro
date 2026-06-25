function esc(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str ?? ''));
    return div.innerHTML;
}

const DB = {
    get(key) {
        try { return JSON.parse(localStorage.getItem('dinheiro_' + key)) }
        catch { return null }
    },
    set(key, val) {
        localStorage.setItem('dinheiro_' + key, JSON.stringify(val))
    }
};

const ASSETS = [
    { id: 'geral', name: 'Fórum Geral', icon: '💬', category: 'Geral' },
    { id: 'cdi', name: 'CDI', icon: '📊', category: 'Renda Fixa' },
    { id: 'cdb', name: 'CDB', icon: '🏦', category: 'Renda Fixa' },
    { id: 'lci', name: 'LCI', icon: '🏠', category: 'Renda Fixa' },
    { id: 'lca', name: 'LCA', icon: '🌾', category: 'Renda Fixa' },
    { id: 'lc', name: 'LC (Letra de Câmbio)', icon: '📄', category: 'Renda Fixa' },
    { id: 'cri', name: 'CRI', icon: '📋', category: 'Renda Fixa' },
    { id: 'cra', name: 'CRA', icon: '📋', category: 'Renda Fixa' },
    { id: 'debentures', name: 'Debêntures', icon: '📜', category: 'Renda Fixa' },
    { id: 'lf', name: 'LF (Letra Financeira)', icon: '💰', category: 'Renda Fixa' },
    { id: 'poupanca', name: 'Poupança', icon: '🐖', category: 'Renda Fixa' },
    { id: 'tesouro-selic', name: 'Tesouro Selic', icon: '🇧🇷', category: 'Tesouro Direto' },
    { id: 'tesouro-prefixado', name: 'Tesouro Prefixado', icon: '📈', category: 'Tesouro Direto' },
    { id: 'tesouro-ipca', name: 'Tesouro IPCA+', icon: '📊', category: 'Tesouro Direto' },
    { id: 'acoes', name: 'Ações', icon: '📈', category: 'Renda Variável' },
    { id: 'fiis', name: 'FIIs', icon: '🏢', category: 'Renda Variável' },
    { id: 'etfs', name: 'ETFs', icon: '📊', category: 'Renda Variável' },
    { id: 'bdrs', name: 'BDRs', icon: '🌎', category: 'Renda Variável' },
    { id: 'indices', name: 'Índices', icon: '📉', category: 'Renda Variável' },
    { id: 'derivativos', name: 'Derivativos', icon: '⚡', category: 'Renda Variável' },
    { id: 'fundos', name: 'Fundos de Investimento', icon: '📁', category: 'Renda Variável' },
    { id: 'bitcoin', name: 'Bitcoin', icon: '₿', category: 'Criptomoedas' },
    { id: 'altcoins', name: 'Altcoins', icon: '🪙', category: 'Criptomoedas' },
    { id: 'stablecoins', name: 'Stablecoins', icon: '💲', category: 'Criptomoedas' },
];

const CATEGORIES = ['Geral', 'Renda Fixa', 'Tesouro Direto', 'Renda Variável', 'Criptomoedas'];

const API = {
    get categories() { return CATEGORIES },
    get assets() { return ASSETS },

    getUsers() { return DB.get('users') || [] },
    saveUsers(u) { DB.set('users', u) },

    getPosts(assetId) {
        const all = DB.get('posts') || {};
        return all[assetId] || [];
    },
    savePosts(assetId, posts) {
        const all = DB.get('posts') || {};
        all[assetId] = posts;
        DB.set('posts', all);
    },

    addPost(assetId, userId, userName, message) {
        const posts = this.getPosts(assetId);
        posts.unshift({
            id: Date.now(),
            userId,
            userName,
            message: message.replace(/<[^>]*>/g, '').trim(),
            createdAt: new Date().toISOString()
        });
        this.savePosts(assetId, posts);
        return posts[0];
    },

    register(nome, celular) {
        const users = this.getUsers();
        if (users.find(u => u.celular === celular)) return { error: 'Celular já cadastrado' };
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const user = {
            id: Date.now(),
            nome: nome.replace(/<[^>]*>/g, '').trim(),
            celular: celular.replace(/\D/g, ''),
            senha: celular.replace(/\D/g, '').slice(-4),
            confirmCode: code,
            confirmed: false,
            createdAt: new Date().toISOString()
        };
        users.push(user);
        this.saveUsers(users);
        return { user, code };
    },

    confirm(celular, code) {
        const users = this.getUsers();
        const u = users.find(u => u.celular === celular.replace(/\D/g, ''));
        if (!u) return { error: 'Usuário não encontrado' };
        if (u.confirmed) return { error: 'Usuário já confirmado' };
        if (u.confirmCode !== code.trim()) return { error: 'Código inválido' };
        u.confirmed = true;
        this.saveUsers(users);
        return { success: true };
    },

    login(celular, senha) {
        const users = this.getUsers();
        const u = users.find(u => u.celular === celular.replace(/\D/g, ''));
        if (!u) return { error: 'Celular não cadastrado' };
        if (!u.confirmed) return { error: 'Confirme seu WhatsApp primeiro' };
        if (u.senha !== senha) return { error: 'Senha incorreta' };
        DB.set('session', u.id);
        return { user: u };
    },

    logout() { DB.set('session', null) },

    getSession() {
        const id = DB.get('session');
        if (!id) return null;
        return this.getUsers().find(u => u.id === id) || null;
    },

    // APIs externas gratuitas
    async fetchSelic() {
        try {
            const r = await fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.11/dados/ultimos/1');
            const d = await r.json();
            return { valor: parseFloat(d[0]?.valor || 0).toFixed(2), data: d[0]?.data || '' };
        } catch { return null }
    },

    async fetchCDI() {
        try {
            const r = await fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados/ultimos/1');
            const d = await r.json();
            return { valor: parseFloat(d[0]?.valor || 0).toFixed(2), data: d[0]?.data || '' };
        } catch { return null }
    },

    async fetchIPCA() {
        try {
            const r = await fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados/ultimos/1');
            const d = await r.json();
            return { valor: parseFloat(d[0]?.valor || 0).toFixed(2), data: d[0]?.data || '' };
        } catch { return null }
    },

    async fetchQuote(ticker) {
        try {
            const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.SA?range=1d&interval=1d`);
            const d = await r.json();
            const m = d.chart?.result?.[0]?.meta;
            if (!m) return null;
            return {
                ticker,
                name: m.shortName || m.longName || ticker,
                price: m.regularMarketPrice || m.previousClose || 0,
                currency: m.currency || 'BRL',
                change: m.chartPreviousClose ? ((m.regularMarketPrice / m.chartPreviousClose - 1) * 100).toFixed(2) : 0
            };
        } catch { return null }
    },

    async fetchCrypto(ticker) {
        try {
            const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}-USD?range=1d&interval=1d`);
            const d = await r.json();
            const m = d.chart?.result?.[0]?.meta;
            if (!m) return null;
            return {
                ticker,
                name: m.shortName || ticker,
                price: m.regularMarketPrice || 0,
                change: m.chartPreviousClose ? ((m.regularMarketPrice / m.chartPreviousClose - 1) * 100).toFixed(2) : 0
            };
        } catch { return null }
    },

    async fetchIbovespa() {
        try {
            const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/^BVSP?range=1d&interval=1d');
            const d = await r.json();
            const m = d.chart?.result?.[0]?.meta;
            if (!m) return null;
            return {
                name: 'Ibovespa',
                price: m.regularMarketPrice || 0,
                change: m.chartPreviousClose ? ((m.regularMarketPrice / m.chartPreviousClose - 1) * 100).toFixed(2) : 0
            };
        } catch { return null }
    },

    async fetchTesouro() {
        try {
            const r = await fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.7829/dados/ultimos/1');
            const d = await r.json();
            return { valor: parseFloat(d[0]?.valor || 0).toFixed(2), data: d[0]?.data || '' };
        } catch { return null }
    },

    async fetchPoupanca() {
        try {
            const r = await fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.195/dados/ultimos/1');
            const d = await r.json();
            return { valor: parseFloat(d[0]?.valor || 0).toFixed(2), data: d[0]?.data || '' };
        } catch { return null }
    }
};

window.API = API;
window.ASSETS = ASSETS;
window.CATEGORIES = CATEGORIES;
