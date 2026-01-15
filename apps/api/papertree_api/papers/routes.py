import os
import uuid
from datetime import datetime
from typing import List, Optional

from bson import ObjectId
from fastapi import (APIRouter, Depends, File, Header, HTTPException,
                     UploadFile, status)
from fastapi.responses import FileResponse, StreamingResponse
from papertree_api.auth.utils import decode_token, get_current_user
from papertree_api.config import get_settings
from papertree_api.database import get_database

from .models import PaperDetailResponse, PaperResponse, SearchResult
from .services import extract_pdf_content, search_in_text

settings = get_settings()
router = APIRouter()


@router.post("/upload", response_model=PaperResponse)
async def upload_paper(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    """
    Upload a PDF paper.
    Extracts text content and stores metadata.
    """
    # Validate file type
    if not file.filename.endswith('.pdf'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF files are allowed"
        )
    
    # Generate unique filename
    file_id = str(uuid.uuid4())
    original_name = file.filename
    safe_filename = f"{file_id}.pdf"
    file_path = os.path.join(settings.storage_path, safe_filename)
    
    # Ensure storage directory exists
    os.makedirs(settings.storage_path, exist_ok=True)
    
    # Save file
    try:
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save file: {str(e)}"
        )
    
    # Extract content
    extracted_text, outline, page_count = extract_pdf_content(file_path)
    
    # Get title from filename (without extension)
    title = os.path.splitext(original_name)[0]
    
    # Create paper document
    paper_doc = {
        "user_id": current_user["id"],
        "title": title,
        "filename": original_name,
        "file_path": file_path,
        "created_at": datetime.utcnow(),
        "extracted_text": extracted_text,
        "outline": outline,
        "page_count": page_count
    }
    
    db = get_database()
    result = await db.papers.insert_one(paper_doc)
    
    return PaperResponse(
        id=str(result.inserted_id),
        user_id=current_user["id"],
        title=title,
        filename=original_name,
        created_at=paper_doc["created_at"],
        page_count=page_count
    )


@router.get("", response_model=List[PaperResponse])
async def list_papers(current_user: dict = Depends(get_current_user)):
    """
    List all papers for the current user.
    """
    db = get_database()
    cursor = db.papers.find({"user_id": current_user["id"]}).sort("created_at", -1)
    
    papers = []
    async for paper in cursor:
        papers.append(PaperResponse(
            id=str(paper["_id"]),
            user_id=paper["user_id"],
            title=paper["title"],
            filename=paper["filename"],
            created_at=paper["created_at"],
            page_count=paper.get("page_count")
        ))
    
    return papers


@router.get("/{paper_id}", response_model=PaperDetailResponse)
async def get_paper(
    paper_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Get paper details including extracted text.
    """
    db = get_database()
    
    try:
        paper = await db.papers.find_one({
            "_id": ObjectId(paper_id),
            "user_id": current_user["id"]
        })
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Paper not found"
        )
    
    if not paper:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Paper not found"
        )
    
    return PaperDetailResponse(
        id=str(paper["_id"]),
        user_id=paper["user_id"],
        title=paper["title"],
        filename=paper["filename"],
        created_at=paper["created_at"],
        extracted_text=paper.get("extracted_text"),
        outline=paper.get("outline", []),
        page_count=paper.get("page_count")
    )


@router.get("/{paper_id}/file")
async def get_paper_file(
    paper_id: str,
    token: Optional[str] = None,
    authorization: Optional[str] = Header(None)
):
    """
    Get the PDF file for a paper.
    Supports both query param token and Authorization header.
    """
    # Extract token from either source
    auth_token = None
    if authorization and authorization.startswith("Bearer "):
        auth_token = authorization[7:]
    elif token:
        auth_token = token
    
    if not auth_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required"
        )
    
    # Decode token
    payload = decode_token(auth_token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token"
        )
    
    user_id = payload.get("sub")
    
    db = get_database()
    
    try:
        paper = await db.papers.find_one({
            "_id": ObjectId(paper_id),
            "user_id": user_id
        })
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Paper not found"
        )
    
    if not paper:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Paper not found"
        )
    
    file_path = paper["file_path"]
    if not os.path.exists(file_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found"
        )
    
    # Return file with proper headers for PDF viewing
    return FileResponse(
        file_path,
        media_type="application/pdf",
        filename=paper["filename"],
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Content-Disposition"
        }
    )


@router.get("/{paper_id}/text")
async def get_paper_text(
    paper_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Get extracted text content of a paper.
    """
    db = get_database()
    
    try:
        paper = await db.papers.find_one({
            "_id": ObjectId(paper_id),
            "user_id": current_user["id"]
        })
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Paper not found"
        )
    
    if not paper:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Paper not found"
        )
    
    return {
        "text": paper.get("extracted_text", ""),
        "outline": paper.get("outline", [])
    }


@router.delete("/{paper_id}")
async def delete_paper(
    paper_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Delete a paper and all associated data.
    """
    db = get_database()
    
    try:
        paper = await db.papers.find_one({
            "_id": ObjectId(paper_id),
            "user_id": current_user["id"]
        })
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Paper not found"
        )
    
    if not paper:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Paper not found"
        )
    
    # Delete the file
    if os.path.exists(paper["file_path"]):
        os.remove(paper["file_path"])
    
    # Delete associated data
    await db.highlights.delete_many({"paper_id": paper_id})
    await db.explanations.delete_many({"paper_id": paper_id})
    await db.canvases.delete_many({"paper_id": paper_id})
    
    # Delete the paper
    await db.papers.delete_one({"_id": ObjectId(paper_id)})
    
    return {"message": "Paper deleted successfully"}


@router.get("/{paper_id}/search", response_model=List[SearchResult])
async def search_paper(
    paper_id: str,
    q: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Search within a paper's text content.
    """
    if not q or len(q) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Search query must be at least 2 characters"
        )
    
    db = get_database()
    
    try:
        paper = await db.papers.find_one({
            "_id": ObjectId(paper_id),
            "user_id": current_user["id"]
        })
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Paper not found"
        )
    
    if not paper:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Paper not found"
        )
    
    text = paper.get("extracted_text", "")
    results = search_in_text(text, q)
    
    return [SearchResult(**r) for r in results]