# PaperTree 🌳📄

A research paper reader with AI-powered explanations, highlighting, and an infinite canvas for organizing thoughts.

## Features

- **PDF Reader** with highlighting support
- **Book Mode** for comfortable reading
- **AI Explanations** powered by OpenRouter
- **Explanation Trees** for follow-up questions
- **Infinite Canvas** to visualize paper concepts
- **Full-text Search** within papers

## Prerequisites

- Docker & Docker Compose
- OpenRouter API Key (get one at https://openrouter.ai)

## Quick Start

### 1. Clone and Setup

```bash
# Clone the repository
git clone <your-repo-url>
cd papertree

# Create environment file
cp .env.example .env
```

### 2. Configure Environment

Edit `.env` and add your OpenRouter API key:

```
OPENROUTER_API_KEY=your-openrouter-api-key-here
```

### 3. Start the Application

```bash
# Build and start all services
docker-compose up --build

# Or run in background
docker-compose up --build -d
```

### 4. Access the Application

- **Frontend**: http://localhost:3000
- **API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs

## Development Setup (Without Docker)

### Backend (FastAPI)

```bash
cd apps/api

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Copy and configure environment
cp .env.example .env
# Edit .env with your settings

# Run the server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend (Next.js)

```bash
cd apps/web

# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env.local

# Run development server
npm run dev
```

### MongoDB

```bash
# Run MongoDB locally
docker run -d -p 27017:27017 --name papertree-mongo mongo:7
```

## Usage Guide

1. **Register/Login**: Create an account or login
2. **Upload Paper**: Click "Upload Paper" on the dashboard
3. **Read & Highlight**: Select text in PDF or Book mode
4. **Ask AI**: Click "Ask AI" on highlighted text
5. **Follow-up**: Ask follow-up questions to create explanation trees
6. **Canvas**: Send explanations to the canvas for visual organization

## Tech Stack

- **Frontend**: Next.js 14, TypeScript, TailwindCSS, Zustand, TanStack Query
- **Backend**: FastAPI, Python 3.11, Motor (MongoDB async driver)
- **Database**: MongoDB
- **AI**: OpenRouter (OpenAI-compatible API)
- **PDF**: PDF.js via react-pdf

## API Documentation

Visit http://localhost:8000/docs for interactive API documentation.

## Troubleshooting

### PDF Worker Issues

If PDF doesn't render, ensure the PDF.js worker is properly loaded.

### MongoDB Connection

If the API can't connect to MongoDB, ensure the MongoDB container is running:

```bash
docker-compose logs mongo
```

### OpenRouter Issues

Ensure your API key is valid and has credits available.
