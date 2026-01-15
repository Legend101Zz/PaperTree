from datetime import datetime

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status
from papertree_api.auth.utils import get_current_user
from papertree_api.database import get_database

from .models import CanvasResponse, CanvasUpdate

router = APIRouter()


@router.get("/papers/{paper_id}/canvas", response_model=CanvasResponse)
async def get_canvas(
    paper_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Get canvas for a paper. Creates one if it doesn't exist.
    """
    db = get_database()
    
    # Verify paper exists
    try:
        paper = await db.papers.find_one({
            "_id": ObjectId(paper_id),
            "user_id": current_user["id"]
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
    
    # Get or create canvas
    canvas = await db.canvases.find_one({
        "paper_id": paper_id,
        "user_id": current_user["id"]
    })
    
    if not canvas:
        # Create new canvas with default elements
        canvas_doc = {
            "paper_id": paper_id,
            "user_id": current_user["id"],
            "elements": {
                "nodes": [],
                "edges": []
            },
            "updated_at": datetime.utcnow()
        }
        result = await db.canvases.insert_one(canvas_doc)
        canvas = canvas_doc
        canvas["_id"] = result.inserted_id
    
    return CanvasResponse(
        id=str(canvas["_id"]),
        paper_id=canvas["paper_id"],
        user_id=canvas["user_id"],
        elements=canvas["elements"],
        updated_at=canvas["updated_at"]
    )


@router.put("/papers/{paper_id}/canvas", response_model=CanvasResponse)
async def update_canvas(
    paper_id: str,
    canvas_data: CanvasUpdate,
    current_user: dict = Depends(get_current_user)
):
    """
    Update canvas for a paper.
    """
    db = get_database()
    
    # Verify paper exists
    try:
        paper = await db.papers.find_one({
            "_id": ObjectId(paper_id),
            "user_id": current_user["id"]
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
    
    now = datetime.utcnow()
    
    # Upsert canvas
    result = await db.canvases.find_one_and_update(
        {
            "paper_id": paper_id,
            "user_id": current_user["id"]
        },
        {
            "$set": {
                "elements": canvas_data.elements,
                "updated_at": now
            },
            "$setOnInsert": {
                "paper_id": paper_id,
                "user_id": current_user["id"]
            }
        },
        upsert=True,
        return_document=True
    )
    
    return CanvasResponse(
        id=str(result["_id"]),
        paper_id=result["paper_id"],
        user_id=result["user_id"],
        elements=result["elements"],
        updated_at=result["updated_at"]
    )