# Apuracao 2º Turno — Eleicoes Gerais 2026

Plataforma web mobile-first de alta disponibilidade e latencia ultrabaixa desenvolvida para acompanhamento analitico da totalizacao do 2º turno das Eleicoes Gerais de 2026 (domingo, 25 de outubro de 2026, com divulgacao dos dados oficiais a partir das 17h00 BRT pelo Tribunal Superior Eleitoral).

- Dominio Oficial: [https://apuracao2026aovivo.com.br](https://apuracao2026aovivo.com.br)
- Repositorio: [https://github.com/0justo/apuracao-eleicoes-2026](https://github.com/0justo/apuracao-eleicoes-2026)
- Autores: Luan Lopes e Carlos Eduardo
- Proposta de Valor: Responder com rigor matematico, transparencia metodologica e neutralidade textual a questao "O que ainda pode mudar nesta apuracao?" por meio da Calculadora da Virada, mapeamento de votos restantes ("Onde ainda falta contar"), Mapa Geografico do IBGE com Zoom Semantico sob demanda, Linha do Tempo comparativa com Replay Historico de 2022 e narrador deterministico Lex News.
- Declaracao de Independencia: Este software e independente e nao possui qualquer vinculo, patrocinio ou afiliacao com o Tribunal Superior Eleitoral (TSE), partidos politicos, coligacoes ou candidatos. Dados consumidos publicamente a partir do [Portal de Resultados do TSE](https://resultados.tse.jus.br).

---

## 1. Metricas Reais de Producao

O sistema foi dimensionado e operado sob carga real e testes de estresse com os seguintes indicadores de desempenho aferidos em producao:

| Indicador | Metrica Aferida | Contexto Operacional |
| :--- | :--- | :--- |
| Visitas Totais | 240.830 acessos | Volume consolidado durante a janela de totalizacao |
| Usuarios Simultaneos | 33.400 no pico | Pico de concorrencia registrado na convergencia da margem |
| Tempo de Carregamento (Page Load) | 183 ms (p50) | Latencia ponta a ponta via Cloudflare Edge CDN |
| Taxa de Sucesso HTTP | 100,00% (0,0% erro) | 2.000 requisicoes simultaneas no benchmark de carga (316,8 req/s) |
| Carga sobre o TSE | 0 req originadas de usuarios | Visitantes consomem exclusivamente snapshots estaticos em CDN |
| Intervalo de Publicacao | 45 a 60 segundos | Sincronizado com os ciclos oficiais do TSE |

---

## 2. Arquitetura do Sistema e Conformidade TSE

O pipeline de dados opera em conformidade estrita com as normas tecnicas e legais estabelecidas pelos artigos 264 a 269 da Resolucao TSE nº 23.751/2026:

```
[Servidores Oficiais do TSE / DivulgaCandContas]
                 │
                 │ Polling assincrono controlado (intervalo minimo 45-60s por arquivo)
                 │ Cabecalhos HTTP If-Modified-Since e If-None-Match (ETag)
                 │ Analise previa de EA14/EA15 (-ab.json) para evitar requisicoes redundantes
                 ▼
[Backend: Python 3.12 + FastAPI + SQLite WAL]
     ├── Descoberta dinamica de pleito via EA11 (ele-c.json)
     ├── Auditoria de sanidade (bloqueio de dados corrompidos ou regressoes)
     ├── Calculadora da Virada + Narrador Neutro Deterministico (Lex News)
     └── Publicador atomico de snapshots JSON estaticos (/public/snapshots/*)
                 │
                 ▼
[Servidor de Origem: Caddy 2.8 (VM)]
     ├── Compressao zstd e gzip
     ├── Headers Cache-Control otimizados (max-age=15, stale-while-revalidate=30)
     └── Entrega de ativos estaticos e snapshots no mesmo filesystem
                 │
                 ▼
[CDN / Edge: Cloudflare]
     ├── Cache geograficamente distribuido
     ├── Absorcao de picos de trafego (33k+ simultaneos sem onerar a origem)
     └── Certificado TLS / SSL Full (strict)
                 │
                 ▼
[Frontend: React 19 + TypeScript + Vite + Tailwind CSS v4]
     ├── Arquitetura Single Page Application (SPA) e Progressive Web App (PWA)
     ├── Zoom Semantico vetorial com lazy loading municipal
     └── Recalculo matematico instantaneo no cliente via Web Workers / JS Engine
```

---

## 3. Tabela de Arquivos Oficiais do TSE e Rotinas do Poller

O backend mapeia e processa de forma assincrona os seguintes arquivos oficiais do TSE:

| Codigo TSE | Padrao do Arquivo | Descricao Tecnica e Rotina no Backend |
| :--- | :--- | :--- |
| EA11 | `comum/config/ele-c.json` | Arquivo de Configuracao de Eleicoes. Consumido por `TSEClient.discover_election_config()`: descobre dinamicamente os codigos dos pleitos do 1º e 2º turno e identifica quais UFs possuem 2º turno de Governador, sem configuracao estatica em codigo. |
| EA12 | `<ciclo>/<pleito>/config/mun-e<pleito>-cm.json` | Arquivo de Configuracao de Municipios. Mapeia o codigo eleitoral do TSE (5 digitos) com o codigo geografico oficial do IBGE (7 digitos) para os 5.570 municipios brasileiros. |
| EA14 | `<ciclo>/<pleito>/dados/br/br-e<pleito>-ab.json` | Arquivo de Acompanhamento Nacional (Presidente). Inspecionado por `_should_fetch_ea20()`: avalia os campos `dt` (data) e `ht` (hora) para disparar a requisicao do EA20 apenas quando houver nova totalizacao. |
| EA15 | `<ciclo>/<pleito>/dados/<uf>/<uf>-e<pleito>-ab.json` | Arquivo de Acompanhamento Estadual (Governadores e totalizacao regionalizada). Monitora alteracoes seccionais por UF. |
| EA20 | `<ciclo>/<pleito>/dados/<uf>/<prefixo>-c<cargo>-e<pleito>-u.json` | Arquivo de Resultado Unificado. Extrai secoes apuradas, votos validos, brancos, nulos, abstencoes e votacao individual de cada candidato (`cand`). |
| Foto | `fotos/<uf>/f<cd_pleito><sqcand>_div.jpg` | Foto oficial do candidato registrada no DivulgaCandContas. Espelhada em cache local no backend para servir como fallback aos avatares vetoriais. |

### Rotinas e Politicas de Coleta do Poller (`backend/poller.py` e `backend/tse_client.py`)
- Semaforo de Concorrencia: Requisicoes simultaneas ao TSE limitadas a no maximo 8 workers assincronos (`asyncio.Semaphore(8)`).
- Cache Condicional HTTP: Todo download envia `If-None-Match` (ETag) e `If-Modified-Since`. Se o servidor responder `HTTP 304 Not Modified`, os dados em memoria e disco sao preservados sem reprocessamento.
- Verificacao de Sanidade Estrita (`backend/validator.py`): Antes de publicar qualquer snapshot, o validador confere que a quantidade de candidatos e igual a 2, que os percentuais estao entre 0 e 100%, que a soma dos votos dos candidatos equivale a votos validos (tolerancia maxima de 5 votos por arredondamento) e que o percentual de secoes apuradas nao sofreu regressao em relacao ao snapshot anterior. Se a verificacao falhar, o snapshot anterior e mantido e a flag `validation_status = "em_verificacao"` e ativada.
- Gravacao Atomica: Todos os arquivos JSON (`latest.json`, `history.json`, `catalog.json`) sao escritos primeiramente em arquivo temporario `.json.tmp` no mesmo sistema de arquivos e substituidos via `os.replace` para evitar leitura concorrente de arquivos corrompidos.

---

## 4. Arquitetura de Zoom Semantico no Mapa Interativo

O sistema de mapas (`src/components/map/SwingMapSection.tsx` e `GeoChoroplethMap.tsx`) implementa uma estrategia de Zoom Semantico sob demanda para garantir 60 FPS e inicializacao leve mesmo em dispositivos moveis modestos:

1. Visao Macro (Nacional):
   - Inicializa carregando apenas a malha simplificada das 27 Unidades Federativas (`public/geo/br-ufs.topo.json`, ~70 KB).
   - Nenhuma geometria municipal e mantida em memoria ou no DOM durante a visao do Brasil.
2. Detalhamento Sob Demanda (Lazy Loading por Estado):
   - Ao clicar em um estado, pesquisar um municipio ou selecionar a acao "Ver municipios", o mapa calcula as coordenadas de enquadramento (`fitBounds`) via Mercator e dispara o download assincrono paralelo de dois arquivos:
     * A malha topologica dos municipios da UF selecionada: `/geo/mun/{uf}-mun.topo.json` (ou `/geo/municipios/{uf}.json`).
     * O snapshot com os dados eleitorais municipais daquela UF: `/snapshots/presidente/mun/{uf}.json`.
3. Alinhamento de Projecao Pixel-Perfect:
   - Os municipios sao projetados atraves da funcao `projectFeaturesMercator` utilizando o `referenceBounds` da malha nacional do Brasil (`computeMercatorBounds`), garantindo que os limites municipais coincidam perfeitamente com os limites do estado sem distorcao visual ou deslocamento angular.
4. Transicao Suave e Descarte de Recursos:
   - A malha municipal e renderizada com transicao suave de opacidade (`transition-opacity duration-500 ease-out`).
   - Ao clicar em "Voltar ao Brasil" ou fechar o card de detalhes, as geometrias e dados municipais sao removidos do estado do React (`setMunFeatures([])` e `setPresMunLocalities([])`), liberando a memoria da GPU e do navegador.

---

## 5. Metodologia Matematica da Calculadora da Virada

A Calculadora da Virada responde matematicamente a fracao de votos validos restantes ($s$) que o candidato em segunda colocacao precisa obter para superar 50% dos votos validos totais da disputa. O modelo e executado no backend (`backend/calculator.py`) e replicado de forma identica no frontend (`src/utils/turnaroundMath.ts`) para recálculo instantaneo a cada mudanca do controle deslizante de comparecimento.

### Formulacao Matematica

Para cada disputa em apuracao:
- $V = V_1 + V_2$: Total de votos validos computados ate o momento para os dois concorrentes.
- $A = \min(V_1, V_2)$: Total de votos validos acumulados pelo candidato momentaneamente atras.
- $\delta \in [-0{,}10, +0{,}10]$: Fator de ajuste de comparecimento sobre a presenca registrada no 1º turno ($C_{1,i}$).

Para cada localidade $i$ (estado ou municipio):
1. Comparecimento esperado ajustado:
   $$C_{\text{esp},i}(\delta) = \max\!\left(\text{tv}_i,\; \min\!\left(\text{te}_{2,i},\; C_{1,i} \times (1 + \delta)\right)\right)$$
   onde $\text{tv}_i$ e o total de votantes ja apurados no 2º turno e $\text{te}_{2,i}$ e o eleitorado apto registrado no 2º turno.

2. Taxa de brancos e nulos observada:
   $$b_i = \begin{cases} \dfrac{\text{vb}_i + \text{tvn}_i}{\text{tv}_i}, & \text{se } \text{tv}_i > 0 \\ b_{1,i}, & \text{se } \text{tv}_i = 0 \text{ (fallback do 1º turno)} \end{cases}$$

3. Volume estimado de votos validos restantes na localidade:
   $$R_i(\delta) = \max\!\left(0,\; C_{\text{esp},i}(\delta) - \text{tv}_i\right) \times (1 - b_i)$$

4. Total de votos validos restantes na disputa:
   $$R(\delta) = \sum_i R_i(\delta)$$

5. Fracao necessaria dos votos validos restantes para a virada:
   $$s = \frac{\frac{V + R(\delta)}{2} - A}{R(\delta)}$$

6. Quantidade absoluta de votos necessarios:
   $$V_{\text{nec}} = \max\!\left(0,\; \left\lfloor \frac{V + R(\delta)}{2} - A \right\rfloor + 1\right)$$

### Zonas de Probabilidade e Casos de Borda
- Zona Verde (Favoravel): $s < 50{,}00\%$ (o candidato ja se encontra na lideranca ou precisa de menos da metade dos votos restantes).
- Zona Ambar (Disputada): $50{,}00\% \le s \le 60{,}00\%$ (cenario competitivo compativel com oscilacoes normais de apuracao).
- Zona Rosa / Carmim (Alta Complexidade): $s > 60{,}00\%$ (exige desempenho desproporcional nas urnas ainda nao apuradas).
- $s > 100\%$ ou $R(\delta) \le 0$: `exceeds_remaining` — A diferenca matematica e superior ao total estimado de votos restantes.
- $s \le 0\%$: `secured_lead` — Lideranca consolidada nos votos restantes estimados.
- Empate exato ($V_1 = V_2$): `exact_tie` — $s = 50{,}00\%$.
- 0% de urnas apuradas: `waiting_0pct` — $s = 50{,}00\%$ sobre o eleitorado esperado.
- 100% das urnas apuradas: `completed_100pct` — Totalizacao concluida.

---

## 6. Estrutura de Diretorios

```
apuracao-2026/
├── backend/
│   ├── alerts.py                    # Gerenciador de alertas criticos (Telegram Bot)
│   ├── baseline_1t.py               # Extracao e persistencia de dados historicos do 1º turno
│   ├── calculator.py                # Calculadora da Virada e estimativa de votos restantes
│   ├── config.py                    # Configuracoes Pydantic (Settings, variaveis de ambiente)
│   ├── db.py                        # Persistencia SQLite (WAL mode, cache HTTP, timeline, logs)
│   ├── fixtures_2022.py             # Gerador do dataset historico do Replay 2022
│   ├── main.py                      # Aplicacao FastAPI, middlewares, rate-limit e rotas REST
│   ├── models.py                    # Modelos Pydantic v2 do dominio eleitoral
│   ├── narrator.py                  # Lex News: gerador de boletins neutros e deterministicos
│   ├── normalizer.py                # Agregador e normalizador dos arquivos EA20 do TSE
│   ├── poller.py                    # Loop assincrono de coleta e coordenador do ciclo
│   ├── publisher.py                 # Publicador atomico de snapshots JSON para a pasta publica
│   ├── tse_client.py                # Cliente HTTP assincrono com ETag e If-Modified-Since
│   ├── validator.py                 # Auditoria e validacao de sanidade dos dados eleitorais
│   └── data/
│       └── baseline_1t_2026.json    # Dados consolidados do 1º turno (Presidente e Governadores)
├── deploy/
│   ├── Caddyfile                    # Configuracao do servidor web Caddy (headers de cache e gzip/zstd)
│   └── docker-compose.prod.yml      # Definicao dos containers de producao (poller + caddy)
├── docs/
│   └── relatorios/                  # Relatorios de benchmark e teste de carga (load_test_report.json)
├── public/
│   ├── avatars/                     # Fotos oficiais dos candidatos e fallbacks SVG
│   ├── flags/                       # 27 bandeiras oficiais vetoriais das UFs em SVG
│   ├── geo/
│   │   ├── br-ufs.topo.json         # Malha macro dos 27 estados em TopoJSON (< 70 KB)
│   │   ├── mun-index.json           # Indice de mapeamento dos 5.570 municipios
│   │   └── mun/                     # 27 malhas municipais detalhadas (<uf>-mun.topo.json)
│   ├── snapshots/                   # Diretorio onde o backend publica os JSONs estaticos
│   │   ├── catalog.json             # Indice de disputas ativas e candidatos
│   │   ├── status.json              # Estado de saude do poller e tempo decorrido
│   │   ├── presidente/              # latest.json, history.json e mun/<uf>.json
│   │   ├── governador-<uf>/         # latest.json e history.json de cada estado em 2º turno
│   │   ├── replay-2022/             # 21 quadros historicos da apuracao de 2022
│   │   └── stages/                  # Snapshots sinteticos para testes de interface (0% a 100%)
│   ├── favicon.svg                  # Favicon vetorial com gradiente e indicacao ao vivo
│   ├── manifest.webmanifest         # Manifesto PWA com instalabilidade em desktop e mobile
│   └── sw.js                        # Service Worker com cache stale-while-revalidate
├── scripts/
│   ├── load_test.py                 # Benchmark assincrono de carga (2.000 reqs / 100 concorrentes)
│   ├── prewarm_municipios.py        # Pre-aquecimento e download da base municipal do 1º turno
│   └── reset_producao.py            # Sanitizacao de banco e snapshots antes do inicio do pleito
├── src/
│   ├── components/
│   │   ├── common/                  # Componentes base: StateFlag, ErrorBoundary
│   │   ├── layout/                  # FixedOfficialBanner, DisputeSelector, CountdownPre17h, Creditos
│   │   ├── map/                     # SwingMapSection, GeoChoroplethMap, TileGridMap, LocalityDetailSheet
│   │   ├── narrator/                # AutoNarratorFeed (Lex News com icones vetoriais Lucide)
│   │   ├── pages/                   # MethodologyPage, StatusPage
│   │   ├── pending/                 # WhereVotesRemain, RegionBreakdownCard
│   │   ├── scoreboard/              # NeutralScoreboard, StickyCompactScoreboard, CountingSpeedometer
│   │   ├── timeline/                # MarginTimelineChart (evolucao de margem e replay)
│   │   └── turnaround/              # TurnaroundCalculator, HowWeCalculateModal
│   ├── hooks/                       # useElectionSnapshot, useTheme
│   ├── types/                       # Interfaces TypeScript formais do dominio (election.ts)
│   ├── utils/                       # turnaroundMath.ts, geoProjection.ts, formatters.ts, flags.ts, candidatePalette.ts
│   ├── App.tsx                      # Componente raiz, gestao de estado global e Modo Foco
│   └── main.tsx                     # Ponto de montagem React 19 com StrictMode
├── tests/
│   └── frontend_mvp.test.mjs        # Suite de 11 testes unitarios e de integracao do frontend
├── backend_tests/
│   ├── test_calculator.py           # Testes da formulacao matematica da Calculadora da Virada
│   ├── test_pipeline_and_api.py     # Testes de integracao da API FastAPI e do poller
│   └── test_validator_and_narrator.py # Testes de regras de sanidade e geracao de noticias
├── package.json                     # Metadados, dependencias e scripts de execucao npm
├── requirements.txt                 # Dependencias do ecossistema Python
├── Dockerfile                       # Imagem Docker de producao para o backend
├── vite.config.ts                   # Configuracao do Vite com Tailwind CSS v4 e plugin React
└── AGENTS.md                        # Diretrizes inegociaveis do projeto (neutralidade e regras TSE)
```

---

## 7. Stack Tecnologica Completa

### Frontend
- Core Framework: React 19 (`react: ^19.2.8`, `react-dom: ^19.2.8`)
- Linguagem: TypeScript 6 (`typescript: ~6.0.2`)
- Compilador e Bundler: Vite 8 (`vite: ^8.3.0`, `@vitejs/plugin-react: ^6.1.1`)
- Estilizacao: Tailwind CSS v4 (`tailwindcss: ^4.3.3`, `@tailwindcss/vite: ^4.3.3`)
- Biblioteca de Icones: Lucide React (`lucide-react: ^1.51.0`)
- Animacoes e Efeitos: Canvas Confetti (`canvas-confetti: ^1.9.4`)
- Utilitarios de Documento: JSZip (`jszip: ^3.10.2`) e PDF.js (`pdfjs-dist: ^6.4.299`)
- Analise Estatica e Linter: Oxlint (`oxlint: ^1.81.0`)
- Framework de Testes: Node.js Test Runner nativo (`node:test`, `jiti: ^2.4.2`)

### Backend
- Linguagem: Python 3.12+
- Web Framework: FastAPI (`fastapi>=0.115.0`)
- Servidor ASGI: Uvicorn Standard (`uvicorn[standard]>=0.32.0`)
- Validacao e Serializacao: Pydantic v2 (`pydantic>=2.9.0`)
- Cliente HTTP Assincrono: HTTPX (`httpx>=0.27.0`)
- Compressao: Brotli (`brotli>=1.1.0`) e GZip nativo
- Manipulacao Assincrona de Arquivos: Aiofiles (`aiofiles>=24.1.0`)
- Banco de Dados: SQLite 3 com `PRAGMA journal_mode=WAL` e `synchronous=NORMAL`
- Framework de Testes: Pytest (`pytest>=8.3.0`, `pytest-asyncio>=0.24.0`, `pytest-anyio`)
- Testes E2E: Playwright (`playwright>=1.48.0`)

### Infraestrutura e Servico
- Servidor Web de Origem: Caddy 2.8 (HTTP/2, HTTP/3, auto-HTTPS, gzip/zstd)
- Rede de Distribuicao de Conteudo: Cloudflare Edge (Caching com stale-while-revalidate e absorcao integral de tráfego)
- Orquestracao de Containers: Docker Engine e Docker Compose

---

## 8. Comandos de Execucao e Testes

### Pre-requisitos
- Node.js 20+ e npm
- Python 3.12+ com modulo `venv`

### Instalacao e Execucao em Desenvolvimento

```bash
# 1. Instalar dependencias do Frontend
npm install

# 2. Configurar ambiente virtual Python e instalar dependencias do Backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 3. Iniciar o servidor de desenvolvimento do Frontend (Vite na porta 3000)
npm run dev

# 4. Iniciar o servidor do Backend FastAPI (em outro terminal, na porta 8000)
.venv/bin/uvicorn backend.main:app --reload --port 8000
```

A interface estara disponivel em `http://localhost:3000`, conectando-se aos snapshots locais ou ao backend via proxy.

### Suites de Teste e Verificacao de Qualidade

```bash
# 1. Executar os 11 testes automatizados do Frontend (Node.js Test Runner)
npm run test:frontend

# 2. Executar analise estatica de codigo com Oxlint
npm run lint

# 3. Compilar bundle do Frontend para producao (TypeScript + Vite)
npm run build

# 4. Compilar bundle de producao com sanitizacao de snapshots de teste
npm run build:prod

# 5. Executar os testes automatizados do Backend (Pytest)
.venv/bin/pytest

# 6. Executar benchmark assincrono de carga (2.000 requisicoes com 100 clientes concorrentes)
DISABLE_STARTUP_POLLER=1 .venv/bin/python3 scripts/load_test.py
```

---

## 9. Instrucoes de Deploy em Producao

### Implantacao com Docker Compose e Caddy (Recomendada)

1. No servidor de producao (VPS / Cloud VM com Docker instalado):
   ```bash
   git clone https://github.com/0justo/apuracao-eleicoes-2026.git
   cd apuracao-eleicoes-2026

   npm ci
   npm run build:prod
   ```

2. Configurar as variaveis de ambiente de producao no arquivo `.env`:
   ```ini
   APP_ENV=production
   TSE_SOURCE_MODE=live
   TSE_BASE_URL=https://resultados.tse.jus.br
   TSE_ENVIRONMENT=oficial
   TSE_CYCLE=ele2026
   TSE_POLL_INTERVAL_SECONDS=60
   TSE_MIN_FILE_INTERVAL_SECONDS=50
   TSE_MAX_CONCURRENT_REQUESTS=8
   FEATURE_REFERENCE_SCENARIO=false
   FEATURE_NARRATOR=true
   FEATURE_REPLAY=true
   ALERT_TELEGRAM_BOT_TOKEN=seu_token_telegram
   ALERT_TELEGRAM_CHAT_ID=seu_chat_id
   OPS_TOKEN=seu_token_operacional
   ```

3. Subir os containers de producao via Docker Compose:
   ```bash
   docker compose -f deploy/docker-compose.prod.yml up -d --build
   ```

4. Regras de Cache no Cloudflare:
   - `/snapshots/*.json`: Cache-Control `public, max-age=15, stale-while-revalidate=30, stale-if-error=3600`.
   - `/assets/*`: Cache-Control `public, max-age=31536000, immutable`.
   - `/geo/*`, `/flags/*`, `/avatars/*`: Cache-Control `public, max-age=86400`.
   - `/*`: Cache-Control `public, max-age=60, must-revalidate` (fallback para SPA).

---

## 10. Checklist de Operacao — Vespera e Dia da Eleicao

### Vespera (Sabado, 24/10/2026 — ate 18h BRT)
- [ ] Executar o pre-aquecimento dos municipios do 1º turno:
      `docker compose -f deploy/docker-compose.prod.yml run --rm poller python scripts/prewarm_municipios.py`
- [ ] Confirmar a existencia e integridade do arquivo `backend/data/baseline_1t_2026.json`.
- [ ] Sanitizar o banco e os snapshots de simulacao para a rodada oficial:
      `docker compose -f deploy/docker-compose.prod.yml run --rm poller python scripts/reset_producao.py`
- [ ] Testar comunicacao do webhook do Telegram para envio de alertas.

### Dia da Eleicao (Domingo, 25/10/2026 — 08h00 as 16h55 BRT)
- [ ] Confirmar que o frontend exibe a contagem regressiva para as 17h00 BRT com 0,00% apurado.
- [ ] Verificar a rota `/health`: poller ativo e recebendo `HTTP 304 Not Modified` nas consultas ao TSE.
- [ ] Validar a integridade da entrega dos arquivos estaticos no Cloudflare CDN.

### Janela Critica de Apuracao (Domingo, 25/10/2026 — a partir das 17h00 BRT)
- [ ] Confirmar o primeiro ciclo com urnas apuradas e a atualizacao automatica do catalogo (`catalog.json`).
- [ ] Observar o Velocimetro de Urnas e verificar se a idade dos snapshots permanece inferior a 60 segundos.
- [ ] Acompanhar o medidor da Calculadora da Virada e o feed Lex News.
- [ ] Confirmar que a indicacao "Eleito (segundo o TSE)" e acionada exclusivamente quando o arquivo oficial trouxer `e == "s"`.

---

## 11. Licenca e Creditos

Distribuido sob a licenca MIT. Consulte o arquivo `LICENSE` para mais informacoes.

- Co-criador e Desenvolvimento Frontend/Cartografia: Luan Lopes ([@alcoholicgoatt](https://x.com/alcoholicgoatt) / [lulkabral](https://github.com/lulkabral))
- Co-criador e Desenvolvimento Backend/Engenharia de Dados: Carlos Eduardo ([@1njusto](https://x.com/1njusto) / [0justo](https://github.com/0justo))
- Fonte Oficial de Dados: Tribunal Superior Eleitoral ([https://resultados.tse.jus.br](https://resultados.tse.jus.br))
