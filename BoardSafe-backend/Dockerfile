FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /opt/boardsafe
COPY pyproject.toml README.md ./
COPY app ./app
COPY migrations ./migrations
COPY alembic.ini ./
RUN pip install --no-cache-dir . && useradd -r -u 1101 -m boardsafe && chown -R boardsafe:boardsafe /opt/boardsafe
USER boardsafe
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
