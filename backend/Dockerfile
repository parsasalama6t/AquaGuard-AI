# ── Stage 1: builder ──────────────────────────────────────────────────────────
# Install dependencies in a separate layer so the final image only copies the
# compiled wheels, keeping the image lean.
FROM python:3.11-slim AS builder

WORKDIR /build

# System libs needed to compile OpenCV and MediaPipe wheels
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libglib2.0-0 \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install --prefix=/install --no-cache-dir -r requirements.txt


# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# Runtime system libraries required by OpenCV and MediaPipe
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1 \
    libgomp1 \
    libsm6 \
    libxext6 \
    libxrender1 \
    && rm -rf /var/lib/apt/lists/*

# Copy installed packages from builder stage
COPY --from=builder /install /usr/local

# Copy application source
COPY . .

# Create a non-root user for security
RUN useradd -m -u 1000 aquaguard && chown -R aquaguard:aquaguard /app
USER aquaguard

EXPOSE 8000

# Load .env automatically if present; uvicorn serves the FastAPI app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
