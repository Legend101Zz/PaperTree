from datetime import datetime
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth.utils import get_current_user
from ..database import get_database
from ..services.ai import get_ai_service
from .models import (CATEGORY_COLORS, HighlightCreate, HighlightExplanation,
                     HighlightExplanationCreate, HighlightInDB,
                     HighlightSearchQuery, HighlightUpdate,
                     PaperHighlightCreate, PaperHighlightResponse)

router = APIRouter(prefix="/highlights", tags=["highlights"])

@router.post("/", response_model=HighlightInDB)
async def create_highlight(
    highlight: HighlightCreate,
    user = Depends(get_current_user),
    db = Depends(get_database)
):
    """Create a new highlight."""
    now = datetime.utcnow()
    
    highlight_doc = {
        "user_id": str(user["_id"]),
        "book_id": highlight.book_id,
        "text": highlight.text,
        "position": highlight.position.dict(),
        "category": highlight.category,
        "color": CATEGORY_COLORS[highlight.category],
        "note": highlight.note,
        "tags": highlight.tags,
        "explanation_id": None,
        "canvas_node_id": None,
        "created_at": now,
        "updated_at": now,
    }
    
    result = await db.highlights.insert_one(highlight_doc)
    highlight_doc["_id"] = str(result.inserted_id)
    
    return HighlightInDB(**highlight_doc)

@router.get("/book/{book_id}", response_model=List[HighlightInDB])
async def get_book_highlights(
    book_id: str,
    page: Optional[int] = None,
    category: Optional[str] = None,
    user = Depends(get_current_user),
    db = Depends(get_database)
):
    """Get all highlights for a book."""
    query = {
        "user_id": str(user["_id"]),
        "book_id": book_id
    }
    
    if page is not None:
        query["position.page_number"] = page
    
    if category:
        query["category"] = category
    
    cursor = db.highlights.find(query).sort("position.page_number", 1)
    highlights = await cursor.to_list(length=1000)
    
    return [
        HighlightInDB(**{**h, "_id": str(h["_id"])}) 
        for h in highlights
    ]

@router.get("/{highlight_id}", response_model=HighlightInDB)
async def get_highlight(
    highlight_id: str,
    user = Depends(get_current_user),
    db = Depends(get_database)
):
    """Get a specific highlight."""
    highlight = await db.highlights.find_one({
        "_id": ObjectId(highlight_id),
        "user_id": str(user["_id"])
    })
    
    if not highlight:
        raise HTTPException(status_code=404, detail="Highlight not found")
    
    highlight["_id"] = str(highlight["_id"])
    return HighlightInDB(**highlight)

@router.patch("/{highlight_id}", response_model=HighlightInDB)
async def update_highlight(
    highlight_id: str,
    update: HighlightUpdate,
    user = Depends(get_current_user),
    db = Depends(get_database)
):
    """Update a highlight."""
    update_data = {k: v for k, v in update.dict().items() if v is not None}
    
    if "category" in update_data:
        update_data["color"] = CATEGORY_COLORS[update_data["category"]]
    
    update_data["updated_at"] = datetime.utcnow()
    
    result = await db.highlights.find_one_and_update(
        {"_id": ObjectId(highlight_id), "user_id": str(user["_id"])},
        {"$set": update_data},
        return_document=True
    )
    
    if not result:
        raise HTTPException(status_code=404, detail="Highlight not found")
    
    result["_id"] = str(result["_id"])
    return HighlightInDB(**result)

@router.delete("/{highlight_id}")
async def delete_highlight(
    highlight_id: str,
    user = Depends(get_current_user),
    db = Depends(get_database)
):
    """Delete a highlight."""
    result = await db.highlights.delete_one({
        "_id": ObjectId(highlight_id),
        "user_id": str(user["_id"])
    })
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Highlight not found")
    
    return {"deleted": True}

@router.post("/{highlight_id}/explain", response_model=HighlightExplanation)
async def explain_highlight(
    highlight_id: str,
    request: HighlightExplanationCreate,
    user = Depends(get_current_user),
    db = Depends(get_database)
):
    """Generate AI explanation for a highlight."""
    # Get highlight
    highlight = await db.highlights.find_one({
        "_id": ObjectId(highlight_id),
        "user_id": str(user["_id"])
    })
    
    if not highlight:
        raise HTTPException(status_code=404, detail="Highlight not found")
    
    # Check for existing explanation with same mode (idempotency)
    existing = await db.highlight_explanations.find_one({
        "highlight_id": highlight_id,
        "mode": request.mode
    })
    
    if existing:
        existing["_id"] = str(existing["_id"])
        return HighlightExplanation(**existing)
    
    # Get surrounding context from book
    book = await db.books.find_one({"_id": ObjectId(highlight["book_id"])})
    context = ""
    if book and "pages" in book:
        page_num = highlight["position"]["page_number"]
        if 0 <= page_num < len(book["pages"]):
            context = book["pages"][page_num].get("text", "")[:1000]
    
    # Generate explanation
    ai = get_ai_service()
    result = await ai.generate(
        text=highlight["text"],
        mode=request.mode,
        context=context,
        custom_prompt=request.custom_prompt,
    )
    
    # Store explanation
    explanation_doc = {
        "highlight_id": highlight_id,
        "user_id": str(user["_id"]),
        "book_id": highlight["book_id"],
        "mode": request.mode,
        "prompt": request.custom_prompt or request.mode,
        "response": result["content"],
        "model_name": result["model_name"],
        "model_metadata": {
            "model": result["model"],
            "tokens_used": result["tokens_used"],
            "cost_estimate": result["cost_estimate"],
        },
        "tokens_used": result["tokens_used"],
        "created_at": datetime.utcnow(),
    }
    
    insert_result = await db.highlight_explanations.insert_one(explanation_doc)
    explanation_doc["_id"] = str(insert_result.inserted_id)
    
    # Update highlight with explanation reference
    await db.highlights.update_one(
        {"_id": ObjectId(highlight_id)},
        {"$set": {"explanation_id": str(insert_result.inserted_id)}}
    )
    
    return HighlightExplanation(**explanation_doc)

@router.get("/{highlight_id}/explanations", response_model=List[HighlightExplanation])
async def get_highlight_explanations(
    highlight_id: str,
    user = Depends(get_current_user),
    db = Depends(get_database)
):
    """Get all explanations for a highlight."""
    cursor = db.highlight_explanations.find({
        "highlight_id": highlight_id,
        "user_id": str(user["_id"])
    }).sort("created_at", -1)
    
    explanations = await cursor.to_list(length=50)
    return [
        HighlightExplanation(**{**e, "_id": str(e["_id"])})
        for e in explanations
    ]

@router.post("/search", response_model=List[HighlightInDB])
async def search_highlights(
    query: HighlightSearchQuery,
    user = Depends(get_current_user),
    db = Depends(get_database)
):
    """Search highlights with filters."""
    filter_query = {"user_id": str(user["_id"])}
    
    if query.book_id:
        filter_query["book_id"] = query.book_id
    
    if query.category:
        filter_query["category"] = query.category
    
    if query.tags:
        filter_query["tags"] = {"$in": query.tags}
    
    if query.search_text:
        filter_query["$text"] = {"$search": query.search_text}
    
    if query.page_start is not None or query.page_end is not None:
        page_filter = {}
        if query.page_start is not None:
            page_filter["$gte"] = query.page_start
        if query.page_end is not None:
            page_filter["$lte"] = query.page_end
        filter_query["position.page_number"] = page_filter
    
    cursor = db.highlights.find(filter_query).sort("created_at", -1)
    highlights = await cursor.to_list(length=500)
    
    return [
        HighlightInDB(**{**h, "_id": str(h["_id"])})
        for h in highlights
    ]

@router.get("/export/{book_id}")
async def export_highlights(
    book_id: str,
    format: str = Query("json", regex="^(json|markdown|csv)$"),
    user = Depends(get_current_user),
    db = Depends(get_database)
):
    """Export highlights in various formats."""
    highlights = await get_book_highlights(book_id, user=user, db=db)
    
    if format == "json":
        return {"highlights": [h.dict() for h in highlights]}
    
    elif format == "markdown":
        lines = ["# Highlights Export\n"]
        current_page = -1
        
        for h in highlights:
            if h.position.page_number != current_page:
                current_page = h.position.page_number
                lines.append(f"\n## Page {current_page + 1}\n")
            
            lines.append(f"- **[{h.category}]** {h.text}")
            if h.note:
                lines.append(f"  - *Note:* {h.note}")
            lines.append("")
        
        return {"content": "\n".join(lines), "filename": f"highlights_{book_id}.md"}
    
    elif format == "csv":
        import csv
        import io
        
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Page", "Category", "Text", "Note", "Tags", "Created"])
        
        for h in highlights:
            writer.writerow([
                h.position.page_number + 1,
                h.category,
                h.text,
                h.note or "",
                ", ".join(h.tags),
                h.created_at.isoformat()
            ])
        
        return {"content": output.getvalue(), "filename": f"highlights_{book_id}.csv"}

# ─── NEW: Paper-based highlight routes (used by reader page) ───

@router.get("/papers/{paper_id}", response_model=List[PaperHighlightResponse])
async def list_paper_highlights(
    paper_id: str,
    user=Depends(get_current_user),
    db=Depends(get_database),
):
    """List all highlights for a paper (new reader system)."""
    user_id = user.get("id") or str(user.get("_id"))

    # Query both old (book_id) and new (paper_id) field names
    cursor = db.highlights.find({
        "user_id": user_id,
        "$or": [
            {"paper_id": paper_id},
            {"book_id": paper_id},
        ],
    }).sort("created_at", 1)

    highlights = await cursor.to_list(length=1000)
    results = []
    for h in highlights:
        results.append(PaperHighlightResponse(
            id=str(h["_id"]),
            paper_id=paper_id,
            user_id=user_id,
            mode=h.get("mode", "book"),
            selected_text=h.get("selected_text") or h.get("text", ""),
            page_number=h.get("page_number") or (h.get("position", {}).get("page_number")),
            section_id=h.get("section_id"),
            rects=h.get("rects") or (h.get("position", {}).get("rects")),
            anchor=h.get("anchor"),
            category=h.get("category", "none"),
            color=h.get("color", CATEGORY_COLORS.get(h.get("category", "none"), "#eab308")),
            note=h.get("note"),
            created_at=h.get("created_at", datetime.utcnow()),
        ))
    return results


@router.post("/papers/{paper_id}", response_model=PaperHighlightResponse)
async def create_paper_highlight(
    paper_id: str,
    data: PaperHighlightCreate,
    user=Depends(get_current_user),
    db=Depends(get_database),
):
    """Create highlight using paper_id (new reader system)."""
    user_id = user.get("id") or str(user.get("_id"))
    now = datetime.utcnow()

    color = data.color or CATEGORY_COLORS.get(data.category, "#eab308")

    doc = {
        "paper_id": paper_id,
        "book_id": paper_id,  # backward compat
        "user_id": user_id,
        "mode": data.mode,
        "selected_text": data.selected_text,
        "text": data.selected_text,  # backward compat
        "page_number": data.page_number,
        "section_id": data.section_id,
        "rects": data.rects,
        "anchor": data.anchor,
        "category": data.category,
        "color": color,
        "note": data.note,
        # Legacy position field for backward compat
        "position": {
            "page_number": data.page_number or 0,
            "rects": data.rects or [],
            "text_start": 0,
            "text_end": len(data.selected_text),
        },
        "tags": [],
        "explanation_id": None,
        "canvas_node_id": None,
        "created_at": now,
        "updated_at": now,
    }

    result = await db.highlights.insert_one(doc)
    return PaperHighlightResponse(
        id=str(result.inserted_id),
        paper_id=paper_id,
        user_id=user_id,
        mode=data.mode,
        selected_text=data.selected_text,
        page_number=data.page_number,
        section_id=data.section_id,
        rects=data.rects,
        anchor=data.anchor,
        category=data.category,
        color=color,
        note=data.note,
        created_at=now,
    )


@router.delete("/papers/{paper_id}/{highlight_id}")
async def delete_paper_highlight(
    paper_id: str,
    highlight_id: str,
    user=Depends(get_current_user),
    db=Depends(get_database),
):
    """Delete a highlight and its explanations."""
    user_id = user.get("id") or str(user.get("_id"))

    result = await db.highlights.delete_one({
        "_id": ObjectId(highlight_id),
        "user_id": user_id,
    })
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Highlight not found")

    # Also delete associated explanations
    await db.explanations.delete_many({"highlight_id": highlight_id})

    return {"deleted": True, "highlight_id": highlight_id}