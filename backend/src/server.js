require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/authRoutes');
const empresaRoutes = require('./routes/empresaRoutes');
const certidaoRoutes = require('./routes/certidaoRoutes');
const processoLegalizacaoRoutes = require('./routes/processoLegalizacaoRoutes');
const licencaRoutes = require('./routes/licencaRoutes');
const documentoRoutes = require('./routes/documentoRoutes');
const clienteRoutes = require('./routes/clienteRoutes');
const auditoriaRoutes = require('./routes/auditoriaRoutes');
const tarefaSetorRoutes = require('./routes/tarefaSetorRoutes');
const certificadoDigitalRoutes = require('./routes/certificadoDigitalRoutes');
const onboardingRoutes = require('./routes/onboardingRoutes');
const notificacaoRoutes = require('./routes/notificacaoRoutes');
const guiaImportacaoRoutes = require('./routes/guiaImportacaoRoutes');
const emailEnviadoRoutes = require('./routes/emailEnviadoRoutes');
const conferenciaBancariaRoutes = require('./routes/conferenciaBancariaRoutes');
const caixaPostalRoutes = require('./routes/caixaPostalRoutes');
const ajudaRoutes = require('./routes/ajudaRoutes');
const planejamentoRoutes = require('./routes/planejamentoRoutes');
const contatoSiteRoutes = require('./routes/contatoSiteRoutes');
const permissaoRoutes = require('./routes/permissaoRoutes');
const conectorRoutes = require('./routes/conectorRoutes');
const { iniciarJobVencimentos } = require('./jobs/vencimentosJob');
const { errorHandler } = require('./middlewares/errorHandler');
const { cabecalhosSeguranca } = require('./middlewares/seguranca');

// Sem um JWT_SECRET forte, qualquer um conseguiria forjar um token de
// login — melhor o servidor nem subir do que rodar inseguro.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET ausente ou curto demais no .env (mínimo 32 caracteres). Servidor não iniciado.');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');

// --- Middlewares globais ---
app.use(cabecalhosSeguranca);

// O front-end é servido por este mesmo servidor, então por padrão só
// liberamos CORS para o Live Server de desenvolvimento. Outras origens
// podem ser adicionadas em CORS_ORIGINS no .env (separadas por vírgula).
const origensPermitidas = (process.env.CORS_ORIGINS || 'http://localhost:5500,http://127.0.0.1:5500')
  .split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors({
  origin: (origem, cb) => cb(null, !origem || origensPermitidas.includes(origem))
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve os arquivos do front-end estático (pasta /frontend)
app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));

// --- Rotas da API (todas em JSON, prefixo /api) ---
app.use('/api/auth', authRoutes);
app.use('/api/empresas', empresaRoutes);
app.use('/api/certidoes', certidaoRoutes);
app.use('/api/processos-legalizacao', processoLegalizacaoRoutes);
app.use('/api/licencas', licencaRoutes);
app.use('/api/documentos', documentoRoutes);
// Área do Cliente — login próprio do cliente (e-mail + senha), separado da equipe
app.use('/api/cliente', clienteRoutes);
app.use('/api/auditoria', auditoriaRoutes);
app.use('/api/tarefas-setor', tarefaSetorRoutes);
app.use('/api/certificados-digitais', certificadoDigitalRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/notificacoes', notificacaoRoutes);
app.use('/api/guias', guiaImportacaoRoutes);
app.use('/api/rastreio', emailEnviadoRoutes.rastreio);
app.use('/api/emails-enviados', emailEnviadoRoutes.equipe);
app.use('/api/conferencia-bancaria', conferenciaBancariaRoutes);
app.use('/api/caixa-postal', caixaPostalRoutes);
app.use('/api/ajuda', ajudaRoutes);
app.use('/api/permissoes', permissaoRoutes);
// Conector do Claude (MCP, só consulta) — entra com a chave do conector
app.use('/api/mcp', conectorRoutes.mcp);
app.use('/api/conector', conectorRoutes.chaves);
// Questionário do planejamento: rota pública (link com token) antes da protegida
app.use('/api/planejamento/publico', planejamentoRoutes.publico);
app.use('/api/planejamento', planejamentoRoutes.equipe);
// Formulário de diagnóstico da página Sobre (envio público; lista só do administrador)
app.use('/api/contatos-site', contatoSiteRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 para rotas de API não encontradas
// Modo demonstração: a tela de login mostra os usuários de exemplo
app.get('/api/demo', (req, res) => {
  const { MODO_DEMO, CONTAS_DEMO, CLIENTE_DEMO, SENHA_DEMO } = require('./config/demo');
  if (!MODO_DEMO) return res.json({ demo: false });
  res.json({ demo: true, senha: SENHA_DEMO, contas: CONTAS_DEMO.map(({ email, rotulo }) => ({ email, rotulo })), cliente: CLIENTE_DEMO });
});

app.use('/api', (req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada.' });
});

// Tratamento global de erros — sempre por último
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  iniciarJobVencimentos();
});
