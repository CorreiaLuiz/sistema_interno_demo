-- Permissões por perfil mudadas pelo administrador (tela Usuários → Permissões dos perfis).
-- Só guarda o que foi MUDADO: permissão sem linha aqui vale o padrão de
-- backend/src/config/permissoes.js. O administrador tem tudo sempre.

CREATE TABLE IF NOT EXISTS permissoes_perfil (
    chave VARCHAR(60) PRIMARY KEY,           -- ex: empresas.editar
    papeis TEXT[] NOT NULL DEFAULT '{}',     -- perfis que podem (além do administrador)
    atualizado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);
