function esc(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str ?? ''));
    return div.innerHTML;
}

const DB = {
    prefix: 'dinheiro_',
    get(key) {
        try { return JSON.parse(localStorage.getItem(this.prefix + key)) }
        catch { return null }
    },
    set(key, val) {
        localStorage.setItem(this.prefix + key, JSON.stringify(val))
    },
    table(name) {
        const data = this.get(name) || [];
        return {
            all: () => [...data],
            find: (fn) => data.find(fn),
            filter: (fn) => data.filter(fn),
            push(item) {
                item._id = Date.now() + Math.floor(Math.random() * 999);
                data.push(item);
                this.set(name, data);
                return item;
            },
            update(id, updates) {
                const idx = data.findIndex(r => r._id === id);
                if (idx === -1) return null;
                data[idx] = { ...data[idx], ...updates };
                this.set(name, data);
                return data[idx];
            },
            delete(id) {
                const idx = data.findIndex(r => r._id === id);
                if (idx === -1) return false;
                data.splice(idx, 1);
                this.set(name, data);
                return true;
            }
        };
    }
};

function seedPadrao() {
    const cats = DB.get('categorias') || [];
    if (cats.length) return;
    const padrao = [
        { nome: 'Moradia', tipo: 'despesa', orcamento_mensal: '1500', icone: '🏠' },
        { nome: 'Alimentação', tipo: 'despesa', orcamento_mensal: '800', icone: '🍽️' },
        { nome: 'Transporte', tipo: 'despesa', orcamento_mensal: '400', icone: '🚗' },
        { nome: 'Saúde', tipo: 'despesa', orcamento_mensal: '300', icone: '🏥' },
        { nome: 'Educação', tipo: 'despesa', orcamento_mensal: '200', icone: '📚' },
        { nome: 'Lazer', tipo: 'despesa', orcamento_mensal: '300', icone: '🎮' },
        { nome: 'Assinaturas', tipo: 'despesa', orcamento_mensal: '100', icone: '📺' },
        { nome: 'Salário', tipo: 'receita', orcamento_mensal: '', icone: '💰' },
        { nome: 'Freelance', tipo: 'receita', orcamento_mensal: '', icone: '💻' },
    ];
    DB.set('categorias', padrao.map((c, i) => ({ _id: i + 1, ...c })));
}

const API = {
    isConfigured() { return true },

    // ====== Transações ======
    async getTransacoes(mes) {
        const t = DB.table('transacoes');
        return t.filter(r => r.data && r.data.startsWith(mes));
    },

    async addTransacao(data) {
        const t = DB.table('transacoes');
        return t.push({ ...data, valor: String(data.valor) });
    },

    async updateTransacao(id, data) {
        const t = DB.table('transacoes');
        return t.update(id, { ...data, valor: String(data.valor) });
    },

    async deleteTransacao(id) {
        const t = DB.table('transacoes');
        return t.delete(id);
    },

    // ====== Categorias ======
    async getCategorias() {
        seedPadrao();
        const t = DB.table('categorias');
        return t.all();
    },

    async addCategoria(data) {
        const t = DB.table('categorias');
        return t.push({ ...data, orcamento_mensal: String(data.orcamento_mensal || '0') });
    },

    async deleteCategoria(id) {
        const t = DB.table('categorias');
        return t.delete(id);
    },

    // ====== Metas ======
    async getMetas() {
        const t = DB.table('metas');
        return t.all().map(m => ({
            _id: m._id,
            nome: m.nome,
            icone: m.icone || '🎯',
            tipo_meta: m.tipo_meta || 'geral',
            valor_alvo: parseFloat(m.valor_alvo || 0),
            valor_atual: parseFloat(m.valor_atual || 0),
            progresso: parseFloat(m.valor_alvo || 0) > 0
                ? Math.min(100, Math.round((parseFloat(m.valor_atual || 0) / parseFloat(m.valor_alvo || 0)) * 100))
                : 0,
            data_alvo: m.data_alvo || ''
        }));
    },

    async addMeta(data) {
        const t = DB.table('metas');
        return t.push({ ...data, valor_alvo: String(data.valor_alvo), valor_atual: String(data.valor_atual || '0') });
    },

    async updateMeta(id, data) {
        const t = DB.table('metas');
        return t.update(id, data);
    },

    async deleteMeta(id) {
        const t = DB.table('metas');
        return t.delete(id);
    },

    // ====== Patrimônio ======
    async getPatrimonio() {
        const t = DB.table('patrimonio');
        return t.all();
    },

    async addPatrimonio(data) {
        const t = DB.table('patrimonio');
        return t.push({ ...data, valor: String(data.valor) });
    },

    async deletePatrimonio(id) {
        const t = DB.table('patrimonio');
        return t.delete(id);
    },

    // ====== Analytics locais ======
    async getResumo(mes) {
        const transacoes = DB.table('transacoes').all();
        const mesTransacoes = transacoes.filter(t => t.data && t.data.startsWith(mes));
        const receitas = mesTransacoes.filter(t => t.tipo === 'receita')
            .reduce((s, t) => s + parseFloat(t.valor || 0), 0);
        const despesas = mesTransacoes.filter(t => t.tipo === 'despesa')
            .reduce((s, t) => s + parseFloat(t.valor || 0), 0);

        const metas = await this.getMetas();
        const totalAlvo = metas.reduce((s, m) => s + m.valor_alvo, 0);
        const totalAtual = metas.reduce((s, m) => s + m.valor_atual, 0);

        const patrimonio = DB.table('patrimonio').all();
        const ativos = patrimonio.filter(i => i.tipo === 'ativo')
            .reduce((s, i) => s + parseFloat(i.valor || 0), 0);
        const passivos = patrimonio.filter(i => i.tipo === 'passivo')
            .reduce((s, i) => s + parseFloat(i.valor || 0), 0);

        return {
            mes,
            receitas,
            despesas,
            saldo: receitas - despesas,
            patrimonio_liquido: ativos - passivos,
            progresso_metas: totalAlvo > 0 ? Math.round((totalAtual / totalAlvo) * 100) : 0
        };
    },

    async getGastosPorCategoria(mes) {
        const transacoes = DB.table('transacoes').all()
            .filter(t => t.tipo === 'despesa' && t.data && t.data.startsWith(mes));
        const categorias = DB.table('categorias').all();

        const gastos = {};
        for (const t of transacoes) {
            const cat = t.categoria || 'Outros';
            gastos[cat] = (gastos[cat] || 0) + parseFloat(t.valor || 0);
        }

        return categorias.map(c => {
            const gasto = gastos[c.nome] || 0;
            const orc = parseFloat(c.orcamento_mensal || 0);
            return {
                id: c._id,
                nome: c.nome,
                icone: c.icone || '📦',
                gasto,
                orcamento: orc,
                progresso: orc > 0 ? Math.round((gasto / orc) * 100) : 0
            };
        });
    },

    async getPatrimonioHistorico(limite) {
        limite = limite || 12;
        const patrimonio = DB.table('patrimonio').all();
        const meses = {};
        for (const r of patrimonio) {
            const mes = (r.data || '').slice(0, 7);
            if (!mes) continue;
            if (!meses[mes]) meses[mes] = { ativos: 0, passivos: 0 };
            const v = parseFloat(r.valor || 0);
            if (r.tipo === 'ativo') meses[mes].ativos += v;
            else if (r.tipo === 'passivo') meses[mes].passivos += v;
        }
        return Object.entries(meses)
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(-limite)
            .map(([mes, vals]) => ({
                mes, ativos: vals.ativos, passivos: vals.passivos,
                patrimonio: vals.ativos - vals.passivos
            }));
    },

    // ====== Reserva de Emergência ======
    async getReserva() {
        const transacoes = DB.table('transacoes').all();
        const mesesAnalise = 6;
        const dataLimite = new Date();
        dataLimite.setMonth(dataLimite.getMonth() - mesesAnalise);
        const limite = dataLimite.toISOString().slice(0, 7);

        const gastosMensais = {};
        for (const t of transacoes) {
            if (t.tipo !== 'despesa' || !t.data || t.data < limite) continue;
            const mes = t.data.slice(0, 7);
            gastosMensais[mes] = (gastosMensais[mes] || 0) + parseFloat(t.valor || 0);
        }

        let totalGastos = 0, mesesComGasto = 0;
        for (const total of Object.values(gastosMensais)) {
            if (total > 0) { totalGastos += total; mesesComGasto++; }
        }
        const mediaGastos = mesesComGasto > 0 ? totalGastos / mesesComGasto : 0;

        const metas = DB.table('metas').all();
        const reservas = metas.filter(m =>
            m.tipo_meta === 'reserva' ||
            (m.nome && (m.nome.toLowerCase().includes('emergência') || m.nome.toLowerCase().includes('emergencia')))
        );

        let valorAtual = 0, valorAlvo = 0;
        for (const r of reservas) {
            valorAtual += parseFloat(r.valor_atual || 0);
            valorAlvo += parseFloat(r.valor_alvo || 0);
        }

        const mesesDesejados = 6;
        const alvoSugerido = valorAlvo > 0 ? valorAlvo : mediaGastos * mesesDesejados;
        const mesesCobertos = mediaGastos > 0 ? (valorAtual / mediaGastos) : 0;
        const progresso = alvoSugerido > 0 ? Math.min(100, Math.round((valorAtual / alvoSugerido) * 100)) : 0;

        return {
            media_gastos_mensais: Math.round(mediaGastos * 100) / 100,
            valor_atual: Math.round(valorAtual * 100) / 100,
            valor_alvo: Math.round(alvoSugerido * 100) / 100,
            meses_cobertos: Math.round(mesesCobertos * 10) / 10,
            meses_desejados: mesesDesejados,
            progresso,
            meses_analisados: mesesComGasto,
            meta_reserva_id: reservas.length > 0 ? reservas[0]._id : null
        };
    }
};

window.API = API;
