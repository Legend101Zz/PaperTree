import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from papertree_api.auth.routes import router as auth_router
from papertree_api.canvas.routes import router as canvas_router
from papertree_api.config import get_settings
from papertree_api.database import close_mongo_connection, connect_to_mongo
from papertree_api.explanations.routes import router as explanations_router
from papertree_api.highlights.routes import router as highlights_router
from papertree_api.papers.routes import router as papers_router

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle application startup and shutdown events."""
    # Startup
    await connect_to_mongo()
    
    # Ensure storage directory exists
    os.makedirs(settings.storage_path, exist_ok=True)
    
    yield
    # Shutdown
    await close_mongo_connection()


app = FastAPI(
    title="PaperTree API",
    description="Research paper reader with AI explanations",
    version="2.0.0",
    lifespan=lifespan
)

# CORS middleware for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

# Include routers
app.include_router(auth_router, prefix="/auth", tags=["Authentication"])
app.include_router(papers_router, prefix="/papers", tags=["Papers"])
app.include_router(highlights_router, prefix="/highlight", tags=["Highlights"])
app.include_router(explanations_router, prefix="/explanations", tags=["Explanations"])
app.include_router(canvas_router, tags=["Canvas"])


@app.get("/")
async def root():
    """Root endpoint - API health check."""
    return {"message": "PaperTree API is running", "version": "2.0.0"}


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}