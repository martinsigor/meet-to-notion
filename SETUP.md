# Setup — Meet to Notion

## 1. Instalar Node.js (caso não tenha)

Baixar Node.js 20 LTS em: https://nodejs.org/en/download
Após instalar, abrir um novo terminal e confirmar: `node --version`

## 2. Instalar dependências

```bash
cd meet-to-notion
npm install
```

## 3. Configurar variáveis de ambiente

```bash
cp .env.example .env
# Editar .env com suas credenciais reais
```

## 4. Obter Google Refresh Token

Opção A — OAuth Playground (mais simples):
1. Acesse https://developers.google.com/oauthplayground/
2. Clique no ícone de engrenagem (canto superior direito)
3. Marque "Use your own OAuth credentials"
4. Preencha Client ID e Client Secret do seu projeto Google Cloud
5. Em "Select & authorize APIs", cole:
   https://www.googleapis.com/auth/drive.readonly
   https://www.googleapis.com/auth/documents.readonly
6. Clique "Authorize APIs" → "Exchange authorization code for tokens"
7. Copie o `refresh_token` para o `.env`

Opção B — via app (rota de auth):
1. Preencha `.env` com CLIENT_ID e CLIENT_SECRET
2. `npm run dev`
3. Abra http://localhost:3000/auth/google
4. Faça login e copie o refresh_token exibido

## 5. Rodar em desenvolvimento

```bash
npm run dev
# Dashboard: http://localhost:3000/dashboard
```

## 6. Testar o pipeline manualmente

```bash
# Opção 1 — com Authorization header:
curl -X POST http://localhost:3000/cron/process \
  -H "Authorization: Bearer SEU_CRON_SECRET"

# Opção 2 — rota de dev (sem header):
curl -X POST http://localhost:3000/dev/trigger
```

## 7. Build para produção

```bash
npm run build
npm start
```

## 8. Deploy no Render

1. Criar conta em https://render.com
2. New → Blueprint → apontar para este repositório
3. O `render.yaml` configura tudo automaticamente
4. Adicionar as env vars marcadas como `sync: false` no painel do Render
5. Deploy!

## Rotas disponíveis

| Rota | Método | Descrição |
|------|--------|-----------|
| `/` | GET | Redireciona para `/dashboard` |
| `/dashboard` | GET | Lista de runs |
| `/dashboard/:id` | GET | Detalhe de um run |
| `/health` | GET | Status do servidor |
| `/cron/process` | POST | Trigger manual (requer `Authorization: Bearer CRON_SECRET`) |
| `/dev/trigger` | POST | Trigger sem auth (só em `NODE_ENV=development`) |
| `/auth/google` | GET | Inicia OAuth flow (só em development) |
| `/auth/callback` | GET | Callback OAuth (só em development) |
