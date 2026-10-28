FROM python:3.11-slim

COPY ./requirements.txt /server/requirements.txt

WORKDIR /server

RUN python -m pip install --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY . /server

EXPOSE 5000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5000"]
