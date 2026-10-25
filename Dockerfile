# ==============================================================================
# Dockerfile — Backend & Poller "Apuração 2º Turno" (Eleições 2026)
# Pronto para deploy em Render, Fly.io ou Railway
# ==============================================================================
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=America/Sao_Paulo \
    PORT=8000

WORKDIR /app

# Instala dependências do sistema mínimas (ca-certificates e tzdata para horário de Brasília)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    tzdata \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Instala só as dependências do backend (o requirements.txt da raiz traz playwright/pytest)
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copia apenas o código do backend e a base REAL do 1º turno (baseline_1t_2026.json).
# NÃO copie public/snapshots nem bancos SQLite: no repositório eles contêm dados SIMULADOS.
# O .dockerignore reforça essa regra.
COPY backend ./backend
# Scripts de operação (pré-aquecimento e reset), rodados com "docker compose run"
COPY scripts/reset_producao.py scripts/prewarm_municipios.py ./scripts/

# Cria diretório de dados SQLite persistente
RUN mkdir -p /app/backend/data

EXPOSE 8000

CMD ["sh", "-c", "exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
