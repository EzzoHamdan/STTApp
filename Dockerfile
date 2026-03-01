FROM python:3.12-slim

# System dependencies for Azure Speech SDK and sounddevice
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libssl-dev \
    libasound2 \
    libportaudio2 \
    portaudio19-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package definition first (better layer caching)
COPY pyproject.toml README.md ./
COPY court_stt/ court_stt/

# Install the package
RUN pip install --no-cache-dir .

# Create sessions directory
RUN mkdir -p sessions

EXPOSE 8000

CMD ["court-stt-server", "--host", "0.0.0.0", "--port", "8000"]
