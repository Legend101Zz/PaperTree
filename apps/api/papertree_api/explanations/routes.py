# apps/api/papertree_api/explanations/routes.py
from datetime import datetime
from typing import List

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status
from papertree_api.auth.utils import get_current_user
from papertree_api.config import get_settings
from papertree_api.database import get_database

from .models import (AskMode, ExplanationCreate, ExplanationResponse,
                     ExplanationThread, ExplanationUpdate, SummarizeRequest)
from .services import call_openrouter, summarize_thread

settings = get_settings()
router = APIRouter()


@router.post("/papers/{paper_id}", response_model=ExplanationResponse)
async def create_explanation(
    paper_id: str,
    explanation_data: ExplanationCreate,
    current_user: dict = Depends(get_current_user)
):
    """
    Create a new AI explanation for a highlight.
    Optionally auto-creates a canvas node.
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
    
    # Get highlight
    try:
        highlight = await db.highlights.find_one({
            "_id": ObjectId(explanation_data.highlight_id),
            "user_id": current_user["id"]
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
    
    # Get context from paper text
    selected_text = highlight["selected_text"]
    paper_text = paper.get("extracted_text", "")
    
    context_before = ""
    context_after = ""
    section_title = ""
    
    if paper_text and selected_text in paper_text:
        idx = paper_text.find(selected_text)
        context_before = paper_text[max(0, idx - 500):idx]
        context_after = paper_text[idx + len(selected_text):idx + len(selected_text) + 500]
    
    # Get section title from anchor if available
    if highlight.get("anchor") and highlight["anchor"].get("section_path"):
        section_title = " > ".join(highlight["anchor"]["section_path"])
    elif highlight.get("section_id") and paper.get("book_content"):
        sections = paper["book_content"].get("sections", [])
        for section in sections:
            if section.get("id") == highlight["section_id"]:
                section_title = section.get("title", "")
                break
    
    # Call AI with ask mode
    try:
        answer = await call_openrouter(
            selected_text=selected_text,
            question=explanation_data.question,
            context_before=context_before,
            context_after=context_after,
            section_title=section_title,
            ask_mode=explanation_data.ask_mode.value
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )
    
    # Create explanation document
    explanation_doc = {
        "paper_id": paper_id,
        "highlight_id": explanation_data.highlight_id,
        "user_id": current_user["id"],
        "parent_id": explanation_data.parent_id,
        "question": explanation_data.question,
        "answer_markdown": answer,
        "model": settings.openrouter_model,
        "ask_mode": explanation_data.ask_mode.value,
        "created_at": datetime.utcnow(),
        "is_pinned": False,
        "is_resolved": False,
        "canvas_node_id": None
    }
    
    result = await db.explanations.insert_one(explanation_doc)
    explanation_id = str(result.inserted_id)
    
    # Auto-create canvas node if requested
    canvas_node_id = None
    if explanation_data.auto_add_to_canvas:
        try:
            from papertree_api.canvas.models import AutoCreateNodeRequest
            from papertree_api.canvas.routes import \
                auto_create_node_from_explanation

            # Create a mock request object
            class MockUser:
                def __init__(self, user_dict):
                    self.user_dict = user_dict
            
            auto_request = AutoCreateNodeRequest(
                highlight_id=explanation_data.highlight_id,
                explanation_id=explanation_id
            )
            
            canvas_node = await auto_create_node_from_explanation(
                paper_id=paper_id,
                request=auto_request,
                current_user=current_user
            )
            
            canvas_node_id = canvas_node.id
            
            # Update explanation with canvas node ID
            await db.explanations.update_one(
                {"_id": result.inserted_id},
                {"$set": {"canvas_node_id": canvas_node_id}}
            )
        except Exception as e:
            # Log but don't fail the explanation creation
            print(f"Failed to auto-create canvas node: {e}")
    
    return ExplanationResponse(
        id=explanation_id,
        paper_id=paper_id,
        highlight_id=explanation_data.highlight_id,
        user_id=current_user["id"],
        parent_id=explanation_data.parent_id,
        question=explanation_data.question,
        answer_markdown=answer,
        model=settings.openrouter_model,
        ask_mode=explanation_data.ask_mode,
        created_at=explanation_doc["created_at"],
        is_pinned=False,
        is_resolved=False,
        canvas_node_id=canvas_node_id
    )


@router.get("/papers/{paper_id}", response_model=List[ExplanationResponse])
async def get_explanations(
    paper_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Get all explanations for a paper.
    """
    db = get_database()
    
    cursor = db.explanations.find({
        "paper_id": paper_id,
        "user_id": current_user["id"]
    }).sort("created_at", 1)
    
    explanations = []
    async for exp in cursor:
        explanations.append(ExplanationResponse(
            id=str(exp["_id"]),
            paper_id=exp["paper_id"],
            highlight_id=exp["highlight_id"],
            user_id=exp["user_id"],
            parent_id=exp.get("parent_id"),
            question=exp["question"],
            answer_markdown=exp["answer_markdown"],
            model=exp["model"],
            ask_mode=AskMode(exp.get("ask_mode", "explain_simply")),
            created_at=exp["created_at"],
            is_pinned=exp.get("is_pinned", False),
            is_resolved=exp.get("is_resolved", False),
            canvas_node_id=exp.get("canvas_node_id")
        ))
    
    return explanations


@router.get("/{explanation_id}/thread", response_model=ExplanationThread)
async def get_explanation_thread(
    explanation_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Get an explanation with its full thread (children).
    """
    db = get_database()
    
    try:
        root_exp = await db.explanations.find_one({
            "_id": ObjectId(explanation_id),
            "user_id": current_user["id"]
        })
    except:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Explanation not found"
        )
    
    if not root_exp:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Explanation not found"
        )
    
    # Build thread recursively
    async def build_thread(exp_id: str) -> ExplanationThread:
        exp = await db.explanations.find_one({"_id": ObjectId(exp_id)})
        
        # Get children
        children = []
        cursor = db.explanations.find({"parent_id": exp_id})
        async for child in cursor:
            child_thread = await build_thread(str(child["_id"]))
            children.append(child_thread)
        
        return ExplanationThread(
            id=str(exp["_id"]),
            paper_id=exp["paper_id"],
            highlight_id=exp["highlight_id"],
            user_id=exp["user_id"],
            parent_id=exp.get("parent_id"),
            question=exp["question"],
            answer_markdown=exp["answer_markdown"],
            model=exp["model"],
            ask_mode=AskMode(exp.get("ask_mode", "explain_simply")),
            created_at=exp["created_at"],
            is_pinned=exp.get("is_pinned", False),
            is_resolved=exp.get("is_resolved", False),
            children=children
        )
    
    return await build_thread(explanation_id)


@router.patch("/{explanation_id}", response_model=ExplanationResponse)
async def update_explanation(
    explanation_id: str,
    update_data: ExplanationUpdate,
    current_user: dict = Depends(get_current_user)
):
    """
    Update explanation (pin/resolve status).
    """
    db = get_database()
    
    try:
        exp = await db.explanations.find_one({
            "_id": ObjectId(explanation_id),
            "user_id": current_user["id"]
        })
    except:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Explanation not found"
        )
    
    if not exp:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Explanation not found"
        )
    
    # Build update
    update_fields = {}
    if update_data.is_pinned is not None:
        update_fields["is_pinned"] = update_data.is_pinned
    if update_data.is_resolved is not None:
        update_fields["is_resolved"] = update_data.is_resolved
    
    if update_fields:
        await db.explanations.update_one(
            {"_id": ObjectId(explanation_id)},
            {"$set": update_fields}
        )
    
    # Get updated document
    updated_exp = await db.explanations.find_one({"_id": ObjectId(explanation_id)})
    
    return ExplanationResponse(
        id=str(updated_exp["_id"]),
        paper_id=updated_exp["paper_id"],
        highlight_id=updated_exp["highlight_id"],
        user_id=updated_exp["user_id"],
        parent_id=updated_exp.get("parent_id"),
        question=updated_exp["question"],
        answer_markdown=updated_exp["answer_markdown"],
        model=updated_exp["model"],
        ask_mode=AskMode(updated_exp.get("ask_mode", "explain_simply")),
        created_at=updated_exp["created_at"],
        is_pinned=updated_exp.get("is_pinned", False),
        is_resolved=updated_exp.get("is_resolved", False),
        canvas_node_id=updated_exp.get("canvas_node_id")
    )


@router.post("/summarize")
async def summarize_explanation_thread(
    request: SummarizeRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Summarize an explanation thread.
    """
    db = get_database()
    
    # Get the root explanation
    try:
        root_exp = await db.explanations.find_one({
            "_id": ObjectId(request.explanation_id),
            "user_id": current_user["id"]
        })
    except:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Explanation not found"
        )
    
    if not root_exp:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Explanation not found"
        )
    
    # Collect all explanations in thread
    async def collect_thread(exp_id: str) -> list:
        explanations = []
        exp = await db.explanations.find_one({"_id": ObjectId(exp_id)})
        if exp:
            explanations.append(exp)
            cursor = db.explanations.find({"parent_id": exp_id})
            async for child in cursor:
                explanations.extend(await collect_thread(str(child["_id"])))
        return explanations
    
    all_explanations = await collect_thread(request.explanation_id)
    
    if not all_explanations:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No explanations found in thread"
        )
    
    try:
        summary = await summarize_thread(all_explanations)
        return {"summary": summary}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )