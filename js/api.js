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

    // ====== Transações ======
    async getTransacoes(mes) {
        const r = await this.request('GET', `/api/transacoes/${mes}`);
        return r.error ? [] : r;
    },

    async addTransacao(data) {
        return this.request('POST', '/transacoes', data);
    },

    async updateTransacao(id, data) {
        return this.request('PUT', `/transacoes/${id}`, data);
    },

    async deleteTransacao(id) {
        return this.request('DELETE', `/transacoes/${id}`);
    },

    // ====== Categorias ======
    async getCategorias() {
        const r = await this.request('GET', '/categorias');
        return r.error ? [] : r;
    },

    async addCategoria(data) {
        return this.request('POST', '/categorias', data);
    },

    async deleteCategoria(id) {
        return this.request('DELETE', `/categorias/${id}`);
    },

    // ====== Metas ======
    async getMetas() {
        const r = await this.request('GET', '/api/metas/progresso');
        return r.error ? [] : r;
    },

    async addMeta(data) {
        return this.request('POST', '/metas', data);
    },

    async updateMeta(id, data) {
        return this.request('PUT', `/metas/${id}`, data);
    },

    async deleteMeta(id) {
        return this.request('DELETE', `/metas/${id}`);
    },

    // ====== Patrimônio ======
    async getPatrimonio() {
        const r = await this.request('GET', '/patrimonio');
        return r.error ? [] : r;
    },

    async addPatrimonio(data) {
        return this.request('POST', '/patrimonio', data);
    },

    async deletePatrimonio(id) {
        return this.request('DELETE', `/patrimonio/${id}`);
    },

    // ====== Resumo / Analytics ======
    async getResumo(mes) {
        const r = await this.request('GET', `/api/resumo?mes=${mes}`);
        return r.error ? null : r;
    },

    async getGastosPorCategoria(mes) {
        const r = await this.request('GET', `/api/gastos-por-categoria/${mes}`);
        return r.error ? [] : r;
    },

    async getPatrimonioHistorico(limite) {
        const r = await this.request('GET', `/api/patrimonio/historico?limite=${limite || 12}`);
        return r.error ? [] : r;
    }
};

window.API = API;
