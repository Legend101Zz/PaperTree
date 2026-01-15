from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class CanvasUpdate(BaseModel):
    """Schema for canvas update."""
    elements: Any  # Excalidraw/ReactFlow JSON


class CanvasResponse(BaseModel):
    """Schema for canvas response."""
    id: str
    paper_id: str
    user_id: str
    elements: Any
    updated_at: datetime