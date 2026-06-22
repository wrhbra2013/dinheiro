function esc(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str ?? ''));
    return div.innerHTML;
}

const API = {
    _config: null,

    get config() {
        if (!this._config) {
            try {
                this._config = JSON.parse(localStorage.getItem('api_config')) || {};
            } catch {
                this._config = {};
            }
        }
        return this._config;
    },

    set config(v) {
        this._config = v;
        localStorage.setItem('api_config', JSON.stringify(v));
    },

    get baseUrl() { return this.config.baseUrl || 'http://localhost:3000'; },
    get token() { return this.config.token || ''; },
    get project() { return this.config.project || 'dinheiro'; },

    async request(method, path, body) {
        const url = `${this.baseUrl}${path}`;
        const opts = {
            method,
            headers: { 'Content-Type': 'application/json' }
        };
        if (this.token) opts.headers['Authorization'] = `Bearer ${this.token}`;
        if (body) opts.body = JSON.stringify(body);
        const res = await fetch(url, opts);
        if (!res.ok) {
            const err = await res.text();
            throw new Error(err || `HTTP ${res.status}`);
        }
        return res.json();
    },

    async create(table, data) {
        return this.request('POST', `/${table}`, data);
    },

    async list(table) {
        return this.request('GET', `/${table}`);
    },

    async update(table, id, data) {
        return this.request('PUT', `/${table}/${id}`, data);
    },

    async remove(table, id) {
        return this.request('DELETE', `/${table}/${id}`);
    },

    async health() {
        return this.request('GET', '/health');
    },

    isConfigured() {
        return !!(this.config.baseUrl && this.config.token);
    }
};

window.API = API;
