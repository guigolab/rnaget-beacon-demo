FROM python:3.11-slim

COPY ./requirements.txt /server/requirements.txt

WORKDIR /server

RUN python -m pip install --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY . /server

EXPOSE 5000

# Single worker: DuckDBStore is in-process. Concurrency is capped via
# API_MAX_INFLIGHT (AnyIO thread limiter) plus UVICORN_LIMIT_CONCURRENCY.
CMD uvicorn app:app --host 0.0.0.0 --port 5000 --workers 1 \
    --limit-concurrency ${UVICORN_LIMIT_CONCURRENCY:-64} \
    --timeout-keep-alive 5
