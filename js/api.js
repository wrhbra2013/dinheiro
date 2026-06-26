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
    _config: null,
    _discovering: null,

    get config() {
        if (!this._config) {
            try { this._config = JSON.parse(localStorage.getItem('api_config')) || {} }
            catch { this._config = {} }
        }
        return this._config;
    },
    set config(v) {
        this._config = v;
        localStorage.setItem('api_config', JSON.stringify(v));
    },

    get baseUrl() { return this.config.baseUrl || '' },
    get token() { return this.config.token || '' },

    isConfigured() { return !!(this.config.baseUrl && this.config.token) },

    async discover() {
        if (this._discovering) return this._discovering;
        this._discovering = (async () => {
            const urls = [];
            if (window.API_CONFIG?.baseUrl) urls.push(window.API_CONFIG.baseUrl);
            const origin = window.location.origin;
            if (origin) {
                urls.push(origin + '/dinheiro/api/');
                urls.push(origin + '/api/');
                urls.push(origin + '/');
            }
            for (const url of urls) {
                try {
                    const r = await fetch(url + 'api-key', { signal: AbortSignal.timeout(4000) });
                    if (r.ok) {
                        const data = await r.json();
                        if (data.token) {
                            this.config = { baseUrl: url, token: data.token };
                            return true;
                        }
                    }
                } catch {}
            }
            return false;
        })();
        const ok = await this._discovering;
        this._discovering = null;
        return ok;
    },

    async request(method, path, body) {
        if (!this.isConfigured()) await this.discover();
        if (!this.isConfigured()) return { error: 'API não configurada' };
        const url = `${this.baseUrl}${path}`;
        const opts = {
            method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` }
        };
        if (body) opts.body = JSON.stringify(body);
        try {
            const res = await fetch(url, opts);
            const text = await res.text();
            try {
                const data = JSON.parse(text);
                if (!res.ok) return { error: data.error || `HTTP ${res.status}` };
                return data;
            } catch {
                if (!res.ok) return { error: text || `HTTP ${res.status}` };
                return text;
            }
        } catch (e) {
            return { error: e.message || 'Erro de conexão' };
        }
    },

    get categories() { return CATEGORIES },
    get assets() { return ASSETS },

    // ==== Usuários (API ou localStorage) ====

    async register(nome, usuario, celular) {
        if (this.isConfigured()) {
            return this.request('POST', '/register', { nome, usuario, celular });
        }
        const users = this._getUsers();
        const digito = celular.replace(/\D/g, '');
        const slug = usuario.replace(/[^a-z0-9._-]/g, '').toLowerCase().trim();
        if (!slug) return { error: 'Usuário inválido' };
        if (users.find(u => u.usuario === slug)) return { error: 'Usuário já existe' };
        if (users.find(u => u.celular === digito)) return { error: 'Celular já cadastrado' };
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const user = {
            id: Date.now(), nome: nome.replace(/<[^>]*>/g, '').trim(),
            usuario: slug, celular: digito, senha: digito.slice(-4),
            confirmCode: code, confirmed: false,
            createdAt: new Date().toISOString()
        };
        users.push(user);
        this._saveUsers(users);
        return { user, code };
    },

    async confirm(celular, code) {
        if (this.isConfigured()) {
            return this.request('POST', '/confirm', { celular, code });
        }
        const users = this._getUsers();
        const u = users.find(u => u.celular === celular.replace(/\D/g, ''));
        if (!u) return { error: 'Usuário não encontrado' };
        if (u.confirmed) return { error: 'Usuário já confirmado' };
        if (u.confirmCode !== code.trim()) return { error: 'Código inválido' };
        u.confirmed = true;
        this._saveUsers(users);
        return { success: true };
    },

    async login(usuario, senha) {
        if (this.isConfigured()) {
            const r = await this.request('POST', '/login', { usuario, senha });
            if (r.user) {
                const key = r.user._id || r.user.id;
                DB.set('session_user', r.user);
                DB.set('session_id', key);
            }
            return r;
        }
        const users = this._getUsers();
        const slug = usuario.replace(/[^a-z0-9._-]/g, '').toLowerCase().trim();
        const u = users.find(u => u.usuario === slug);
        if (!u) return { error: 'Usuário não encontrado' };
        if (!u.confirmed) return { error: 'Confirme seu WhatsApp primeiro' };
        if (u.senha !== senha) return { error: 'Senha incorreta' };
        DB.set('session_id', u.id);
        return { user: u };
    },

    async getMe(userId) {
        if (this.isConfigured()) {
            const r = await this.request('GET', `/usuarios/me?id=${userId}`);
            return r.error ? null : r;
        }
        return this._getUsers().find(u => u.id === userId) || null;
    },

    logout() {
        DB.set('session_id', null);
        DB.set('session_user', null);
    },

    getSession() {
        if (this.isConfigured()) {
            return DB.get('session_user') || null;
        }
        const id = DB.get('session_id');
        if (!id) return null;
        return this._getUsers().find(u => u.id === id) || null;
    },

    _getUsers() { return DB.get('users') || [] },
    _saveUsers(u) { DB.set('users', u) },

    // ==== Mensagens (API ou localStorage) ====

    async getMessages(assetId) {
        if (this.isConfigured()) {
            const r = await this.request('GET', `/mensagens/${assetId}`);
            return r.error ? [] : r;
        }
        const all = DB.get('posts') || {};
        return all[assetId] || [];
    },

    async addPost(assetId, userId, userName, message) {
        const msg = message.replace(/<[^>]*>/g, '').trim();
        if (!msg) return null;
        if (this.isConfigured()) {
            const r = await this.request('POST', '/mensagens', {
                asset: assetId, userId: String(userId), userName, message: msg
            });
            return r.error ? null : r;
        }
        const all = DB.get('posts') || {};
        if (!all[assetId]) all[assetId] = [];
        const post = {
            id: Date.now(), userId, userName, message: msg, createdAt: new Date().toISOString()
        };
        all[assetId].unshift(post);
        DB.set('posts', all);
        return post;
    },

    async deleteMessage(msgId) {
        if (this.isConfigured()) {
            return this.request('DELETE', `/mensagens/${msgId}`);
        }
        return { error: 'Modo local não suporta exclusão' };
    },

    // ==== Fóruns dinâmicos ====

    async getForuns() {
        if (this.isConfigured()) {
            const r = await this.request('GET', '/foruns');
            return r.error ? [] : r;
        }
        return [];
    },

    async createForum(nome, icone, descricao, categoria) {
        if (this.isConfigured()) {
            return this.request('POST', '/foruns', { nome, icone, descricao, categoria });
        }
        return { error: 'API não configurada' };
    },

    async deleteForum(id) {
        if (this.isConfigured()) {
            return this.request('DELETE', `/foruns/${id}`);
        }
        return { error: 'API não configurada' };
    },

    // ==== WhatsApp ====

    async sendWhatsApp(celular, mensagem) {
        if (this.isConfigured()) {
            return this.request('POST', '/whatsapp/send', { celular, mensagem });
        }
        console.log(`[WHATSAPP] Para: ${celular} | ${mensagem}`);
        return { success: true, note: 'modo local' };
    },

    // ==== APIs externas gratuitas ====
    async _proxyFetch(path) {
        if (this.isConfigured()) {
            const r = await this.request('GET', path);
            return r.error ? null : r;
        }
        return null;
    },
    async fetchSelic() {
        const d = await this._proxyFetch('/proxy/bcb/11');
        if (d?.length) return { valor: parseFloat(d[0].valor || 0).toFixed(2), data: d[0].data || '' };
        try {
            const r = await fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.11/dados/ultimos/1');
            const d2 = await r.json();
            return { valor: parseFloat(d2[0]?.valor || 0).toFixed(2), data: d2[0]?.data || '' };
        } catch { return null }
    },
    async fetchCDI() {
        const d = await this._proxyFetch('/proxy/bcb/12');
        if (d?.length) return { valor: parseFloat(d[0].valor || 0).toFixed(2), data: d[0].data || '' };
        try {
            const r = await fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados/ultimos/1');
            const d2 = await r.json();
            return { valor: parseFloat(d2[0]?.valor || 0).toFixed(2), data: d2[0]?.data || '' };
        } catch { return null }
    },
    async fetchIPCA() {
        const d = await this._proxyFetch('/proxy/bcb/433');
        if (d?.length) return { valor: parseFloat(d[0].valor || 0).toFixed(2), data: d[0].data || '' };
        try {
            const r = await fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados/ultimos/1');
            const d2 = await r.json();
            return { valor: parseFloat(d2[0]?.valor || 0).toFixed(2), data: d2[0]?.data || '' };
        } catch { return null }
    },
    async _yahooMeta(ticker) {
        const d = await this._proxyFetch(`/proxy/yahoo/chart/${encodeURIComponent(ticker)}`);
        return d?.chart?.result?.[0]?.meta || null;
    },
    async fetchQuote(ticker) {
        const meta = await this._yahooMeta(`${ticker}.SA`);
        if (meta) return {
            ticker, name: meta.shortName || meta.longName || ticker,
            price: meta.regularMarketPrice || meta.previousClose || 0,
            currency: meta.currency || 'BRL',
            change: meta.chartPreviousClose ? ((meta.regularMarketPrice / meta.chartPreviousClose - 1) * 100).toFixed(2) : 0
        };
        return null;
    },
    async fetchCrypto(ticker) {
        const meta = await this._yahooMeta(`${ticker}-USD`);
        if (meta) return {
            ticker, name: meta.shortName || ticker, price: meta.regularMarketPrice || 0,
            change: meta.chartPreviousClose ? ((meta.regularMarketPrice / meta.chartPreviousClose - 1) * 100).toFixed(2) : 0
        };
        return null;
    },
    async fetchIbovespa() {
        const meta = await this._yahooMeta('^BVSP');
        if (meta) return { name: 'Ibovespa', price: meta.regularMarketPrice || 0,
            change: meta.chartPreviousClose ? ((meta.regularMarketPrice / meta.chartPreviousClose - 1) * 100).toFixed(2) : 0 };
        return null;
    }
};

window.API = API;
window.ASSETS = ASSETS;
window.CATEGORIES = CATEGORIES;
