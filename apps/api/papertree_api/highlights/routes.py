from datetime import datetime
from typing import List

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status
from papertree_api.auth.utils import get_current_user
from papertree_api.database import get_database

from .models import HighlightCreate, HighlightResponse

router = APIRouter()


@router.post("/papers/{paper_id}/highlights", response_model=HighlightResponse)
async def create_highlight(
    paper_id: str,
    highlight_data: HighlightCreate,
    current_user: dict = Depends(get_current_user)
):
    """
    Create a new highlight for a paper.
    """
    db = get_database()
    
    # Verify paper exists and belongs to user
    try:
        paper = await db.papers.find_one({
            "_id": ObjectId(paper_id),
            "user_id": current_user["id"]  # ✅ String comparison
        })
    except:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Paper not found"
        )
    
    if not paper:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Paper not found"
        )
    
    # Create highlight document
    highlight_doc = {
        "paper_id": paper_id,
        "user_id": current_user["id"],
        "mode": highlight_data.mode,
        "selected_text": highlight_data.selected_text,
        "page_number": highlight_data.page_number,
        "rects": [r.model_dump() for r in highlight_data.rects] if highlight_data.rects else None,
        "anchor": highlight_data.anchor.model_dump() if highlight_data.anchor else None,
        "created_at": datetime.utcnow()
    }
    
    result = await db.highlights.insert_one(highlight_doc)
    
    return HighlightResponse(
        id=str(result.inserted_id),
        paper_id=paper_id,
        user_id=current_user["id"],
        mode=highlight_doc["mode"],
        selected_text=highlight_doc["selected_text"],
        page_number=highlight_doc["page_number"],
        rects=highlight_data.rects,
        anchor=highlight_data.anchor,
        created_at=highlight_doc["created_at"]
    )


@router.get("/papers/{paper_id}/highlights", response_model=List[HighlightResponse])
async def get_highlights(
    paper_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Get all highlights for a paper.
    """
    db = get_database()
    
    # Verify paper exists and belongs to user
    try:
        paper = await db.papers.find_one({
            "_id": ObjectId(paper_id),
            "user_id": current_user["id"]  # ✅ String comparison
        })
    except:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Paper not found"
        )
    
    if not paper:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Paper not found"
        )
    
    cursor = db.highlights.find({
        "paper_id": paper_id,
        "user_id": current_user["id"]
    }).sort("created_at", 1)
    
    highlights = []
    async for highlight in cursor:
        highlights.append(HighlightResponse(
            id=str(highlight["_id"]),
            paper_id=highlight["paper_id"],
            user_id=highlight["user_id"],
            mode=highlight["mode"],
            selected_text=highlight["selected_text"],
            page_number=highlight.get("page_number"),
            rects=highlight.get("rects"),
            anchor=highlight.get("anchor"),
            created_at=highlight["created_at"]
        ))
    
    return highlights


@router.delete("/highlights/{highlight_id}")
async def delete_highlight(
    highlight_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Delete a highlight and its associated explanations.
    """
    db = get_database()
    
    try:
        highlight = await db.highlights.find_one({
            "_id": ObjectId(highlight_id),
            "user_id": current_user["id"]  # ✅ String comparison
        })
    except:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Highlight not found"
        )
    
    if not highlight:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Highlight not found"
        )
    
    # Delete associated explanations
    await db.explanations.delete_many({"highlight_id": highlight_id})
    
    # Delete the highlight
    await db.highlights.delete_one({"_id": ObjectId(highlight_id)})
    
    return {"message": "Highlight deleted successfully"}