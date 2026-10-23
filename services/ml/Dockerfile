# syntax=docker/dockerfile:1

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ML_MODEL_DIR=./models

WORKDIR /app

COPY services/ml/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY services/ml/app ./app

# The trained artifact is gitignored, so bake a deterministic model into the image.
RUN python -c "from app.model import train_model; train_model(42, 4000, './models')"

EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
