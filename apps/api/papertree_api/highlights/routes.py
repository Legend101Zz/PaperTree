# apps/api/papertree_api/highlights/routes.py
from datetime import datetime
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status
from papertree_api.auth.utils import get_current_user
from papertree_api.database import get_database

from .models import (CATEGORY_COLORS, HighlightCategory, HighlightCreate,
                     HighlightResponse, HighlightUpdate)

router = APIRouter()


def _highlight_to_response(highlight: dict) -> HighlightResponse:
    """Convert a DB highlight dict to HighlightResponse."""
    category = highlight.get("category", "none")
    color = highlight.get("color") or CATEGORY_COLORS.get(
        category, "#eab308"
    )
    return HighlightResponse(
        id=str(highlight["_id"]),
        paper_id=highlight["paper_id"],
        user_id=highlight["user_id"],
        mode=highlight["mode"],
        selected_text=highlight["selected_text"],
        page_number=highlight.get("page_number"),
        section_id=highlight.get("section_id"),
        rects=highlight.get("rects"),
        anchor=highlight.get("anchor"),
        category=category,
        color=color,
        note=highlight.get("note"),
        created_at=highlight["created_at"],
    )


@router.post(
    "/papers/{paper_id}/highlights",
    response_model=HighlightResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_highlight(
    paper_id: str,
    highlight_data: HighlightCreate,
    current_user: dict = Depends(get_current_user),
):
    """Create a new highlight."""
    db = get_database()

    # Verify paper exists and belongs to user
    try:
        paper = await db.papers.find_one(
            {"_id": ObjectId(paper_id), "user_id": current_user["id"]}
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Paper not found")

    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    # Resolve color
    color = highlight_data.color or CATEGORY_COLORS.get(
        highlight_data.category, "#eab308"
    )

    doc = {
        "paper_id": paper_id,
        "user_id": current_user["id"],
        "mode": highlight_data.mode,
        "selected_text": highlight_data.selected_text,
        "page_number": highlight_data.page_number,
        "section_id": highlight_data.section_id,
        "rects": [r.dict() for r in highlight_data.rects]
        if highlight_data.rects
        else None,
        "anchor": highlight_data.anchor.dict()
        if highlight_data.anchor
        else None,
        "category": highlight_data.category.value,
        "color": color,
        "note": highlight_data.note,
        "created_at": datetime.utcnow(),
    }

    result = await db.highlights.insert_one(doc)
    doc["_id"] = result.inserted_id
    return _highlight_to_response(doc)


@router.get("/papers/{paper_id}/highlights", response_model=List[HighlightResponse])
async def list_highlights(
    paper_id: str,
    category: Optional[str] = Query(None, description="Filter by category"),
    search: Optional[str] = Query(None, description="Search in highlight text"),
    current_user: dict = Depends(get_current_user),
):
    """List all highlights for a paper, with optional category filter and text search."""
    db = get_database()

    # Verify paper ownership
    try:
        paper = await db.papers.find_one(
            {"_id": ObjectId(paper_id), "user_id": current_user["id"]}
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Paper not found")

    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    query: dict = {"paper_id": paper_id, "user_id": current_user["id"]}

    if category:
        query["category"] = category

    if search:
        query["selected_text"] = {"$regex": search, "$options": "i"}

    cursor = db.highlights.find(query).sort("created_at", 1)

    highlights = []
    async for highlight in cursor:
        highlights.append(_highlight_to_response(highlight))

    return highlights


@router.patch("/highlights/{highlight_id}", response_model=HighlightResponse)
async def update_highlight(
    highlight_id: str,
    update_data: HighlightUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Update a highlight's category, color, or note."""
    db = get_database()

    try:
        highlight = await db.highlights.find_one(
            {"_id": ObjectId(highlight_id), "user_id": current_user["id"]}
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Highlight not found")

    if not highlight:
        raise HTTPException(status_code=404, detail="Highlight not found")

    updates = {}
    if update_data.category is not None:
        updates["category"] = update_data.category.value
        # Auto-set color from category unless explicitly overridden
        if update_data.color is None:
            updates["color"] = CATEGORY_COLORS.get(
                update_data.category, "#eab308"
            )
    if update_data.color is not None:
        updates["color"] = update_data.color
    if update_data.note is not None:
        updates["note"] = update_data.note

    if updates:
        await db.highlights.update_one(
            {"_id": ObjectId(highlight_id)}, {"$set": updates}
        )

    updated = await db.highlights.find_one({"_id": ObjectId(highlight_id)})
    return _highlight_to_response(updated)


@router.delete("/highlights/{highlight_id}")
async def delete_highlight(
    highlight_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Delete a highlight and its associated explanations."""
    db = get_database()

    try:
        highlight = await db.highlights.find_one(
            {"_id": ObjectId(highlight_id), "user_id": current_user["id"]}
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Highlight not found")

    if not highlight:
        raise HTTPException(status_code=404, detail="Highlight not found")

    await db.explanations.delete_many({"highlight_id": highlight_id})
    await db.highlights.delete_one({"_id": ObjectId(highlight_id)})

    return {"message": "Highlight deleted successfully"}