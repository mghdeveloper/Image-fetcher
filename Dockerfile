# Use official slim Python 3.11 image
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies for Chromium + fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget curl ca-certificates fonts-liberation \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 \
    libgbm1 libpango-1.0-0 libpangocairo-1.0-0 libasound2 libgtk-3-0 libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright + Chromium with dependencies
RUN python -m playwright install --with-deps chromium

# Copy application code
COPY . .

# Set environment variable for Render
ENV PORT=10000

# Expose the port
EXPOSE 10000

# Use gunicorn to serve Flask app
CMD ["gunicorn", "-b", "0.0.0.0:10000", "app:app", "--workers=1", "--threads=2", "--timeout=60"]
