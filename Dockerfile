FROM python:3.11-slim

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Set work directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY coach.py .
COPY conversation_db.py .
COPY memory.yaml .
COPY presets.yaml .
COPY sites.yaml .
COPY web/ ./web/

# Create data directory
RUN mkdir -p /app/data

# Expose port
EXPOSE 5057

# Start application
CMD ["python", "-m", "uvicorn", "coach:app", "--host", "0.0.0.0", "--port", "5057"]
