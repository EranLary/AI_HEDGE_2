FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Runtime libs needed by WeasyPrint/Matplotlib and PDF/image rendering.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    fonts-dejavu-core \
    libcairo2-dev \
    libffi8 \
    libgdk-pixbuf-2.0-dev \
    libjpeg62-turbo \
    libpango1.0-dev \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libcairo2 \
    libgdk-pixbuf-2.0-0 \
    libpng16-16 \
    pkg-config \
    shared-mime-info \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --upgrade pip && pip install -r /app/requirements.txt

COPY . /app

# Persist outputs/logs on Fly volume mounted at /data.
CMD ["sh", "-c", "mkdir -p /data/outputs /data/logs && rm -rf /app/outputs /app/logs && ln -s /data/outputs /app/outputs && ln -s /data/logs /app/logs && exec python bot/telegram_bot.py"]
