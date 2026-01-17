# apps/api/papertree_api/papers/routes.py
import os
import uuid
from datetime import datetime
from typing import List, Optional

import fitz  # PyMuPDF
from bson import ObjectId
from fastapi import (APIRouter, Depends, File, Header, HTTPException,
                     UploadFile, status)
from fastapi.responses import FileResponse, Response
from papertree_api.auth.utils import decode_token, get_current_user
from papertree_api.config import get_settings
from papertree_api.database import get_database

from .llm_service import generate_book_content
from .models import (BookContent, GenerateBookContentRequest,
                     PaperDetailResponse, PaperResponse, PDFRegion,
                     SearchResult, SmartOutlineItem)

settings = get_settings()
router = APIRouter()


def extract_text_from_pdf(file_path: str) -> tuple[str, int]:
    """Extract plain text and page count from PDF."""
    doc = fitz.open(file_path)
    page_count = len(doc)
    
    text_parts = []
    for page in doc:
        text = page.get_text("text", sort=True)
        if text:
            text_parts.append(f"[Page {page.number + 1}]\n{text}")
    
    doc.close()
    return "\n\n".join(text_parts), page_count


@router.post("/upload", response_model=PaperResponse)
async def upload_paper(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    """Upload a PDF paper."""
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")
    
    file_id = str(uuid.uuid4())
    safe_filename = f"{file_id}.pdf"
    file_path = os.path.join(settings.storage_path, safe_filename)
    os.makedirs(settings.storage_path, exist_ok=True)
    
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
    
    # Extract text for LLM
    extracted_text, page_count = extract_text_from_pdf(file_path)
    
    title = os.path.splitext(file.filename)[0]
    
    paper_doc = {
        "user_id": current_user["id"],
        "title": title,
        "filename": file.filename,
        "file_path": file_path,
        "created_at": datetime.utcnow(),
        "extracted_text": extracted_text,
        "page_count": page_count,
        "book_content": None,  # Generated on demand
        "smart_outline": [],
    }
    
    db = get_database()
    result = await db.papers.insert_one(paper_doc)
    
    return PaperResponse(
        id=str(result.inserted_id),
        user_id=current_user["id"],
        title=title,
        filename=file.filename,
        created_at=paper_doc["created_at"],
        page_count=page_count,
        has_book_content=False
    )


@router.get("", response_model=List[PaperResponse])
async def list_papers(current_user: dict = Depends(get_current_user)):
    """List all papers."""
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
            page_count=paper.get("page_count"),
            has_book_content=paper.get("book_content") is not None
        ))
    
    return papers


@router.get("/{paper_id}", response_model=PaperDetailResponse)
async def get_paper(paper_id: str, current_user: dict = Depends(get_current_user)):
    """Get paper details."""
    db = get_database()
    
    try:
        paper = await db.papers.find_one({
            "_id": ObjectId(paper_id),
            "user_id": current_user["id"]
        })
    except:
        raise HTTPException(status_code=404, detail="Paper not found")
    
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    
    book_content = None
    if paper.get("book_content"):
        book_content = BookContent(**paper["book_content"])
    
    smart_outline = [SmartOutlineItem(**o) for o in paper.get("smart_outline", [])]
    
    return PaperDetailResponse(
        id=str(paper["_id"]),
        user_id=paper["user_id"],
        title=paper["title"],
        filename=paper["filename"],
        created_at=paper["created_at"],
        page_count=paper.get("page_count"),
        has_book_content=book_content is not None,
        extracted_text=paper.get("extracted_text"),
        book_content=book_content,
        smart_outline=smart_outline
    )


@router.post("/{paper_id}/generate-book")
async def generate_book(
    paper_id: str,
    request: GenerateBookContentRequest,
    current_user: dict = Depends(get_current_user)
):
    """Generate LLM book content for a paper."""
    import traceback
    
    db = get_database()
    
    try:
        paper = await db.papers.find_one({
            "_id": ObjectId(paper_id),
            "user_id": current_user["id"]
        })
    except Exception as e:
        print(f"Database error finding paper: {e}")
        raise HTTPException(status_code=404, detail="Paper not found")
    
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    
    # Check if already generated
    if paper.get("book_content") and not request.force_regenerate:
        return {"message": "Book content already exists", "status": "exists"}
    
    extracted_text = paper.get("extracted_text", "")
    page_count = paper.get("page_count", 1)
    
    if not extracted_text:
        raise HTTPException(status_code=400, detail="No text extracted from PDF")
    
    print(f"Generating book content for paper {paper_id}")
    print(f"Text length: {len(extracted_text)}, Page count: {page_count}")
    
    try:
        result = await generate_book_content(extracted_text, page_count)
        print(f"Generated result keys: {result.keys() if result else 'None'}")
        
        # Build smart outline from sections
        smart_outline = []
        for section in result.get("sections", []):
            smart_outline.append({
                "id": f"outline-{section.get('id', 'unknown')}",
                "title": section.get("title", "Untitled"),
                "level": section.get("level", 1),
                "section_id": section.get("id", ""),
                "pdf_page": section.get("pdf_pages", [0])[0] if section.get("pdf_pages") else 0,
                "description": None
            })
        
        # Store in database
        update_result = await db.papers.update_one(
            {"_id": ObjectId(paper_id)},
            {"$set": {
                "book_content": result,
                "smart_outline": smart_outline
            }}
        )
        print(f"Database update: matched={update_result.matched_count}, modified={update_result.modified_count}")
        
        return {"message": "Book content generated", "status": "success"}
        
    except Exception as e:
        print(f"Error generating book content: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{paper_id}/file")
async def get_paper_file(
    paper_id: str,
    token: Optional[str] = None,
    authorization: Optional[str] = Header(None)
):
    """Get the PDF file."""
    auth_token = token or (authorization[7:] if authorization and authorization.startswith("Bearer ") else None)
    
    if not auth_token:
        raise HTTPException(status_code=401, detail="Authentication required")
    
    payload = decode_token(auth_token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    db = get_database()
    paper = await db.papers.find_one({
        "_id": ObjectId(paper_id),
        "user_id": payload["sub"]
    })
    
    if not paper or not os.path.exists(paper["file_path"]):
        raise HTTPException(status_code=404, detail="Paper not found")
    
    return FileResponse(
        paper["file_path"],
        media_type="application/pdf",
        filename=paper["filename"]
    )


@router.get("/{paper_id}/page/{page_num}/image")
async def get_page_image(
    paper_id: str,
    page_num: int,
    token: Optional[str] = None,
    authorization: Optional[str] = Header(None),
    # Region parameters (normalized 0-1)
    x0: float = 0,
    y0: float = 0,
    x1: float = 1,
    y1: float = 1,
    scale: float = 2.0
):
    """
    Get a region of a PDF page as an image.
    Used by the PDF minimap to show specific regions.
    """
    auth_token = token or (authorization[7:] if authorization and authorization.startswith("Bearer ") else None)
    
    if not auth_token:
        raise HTTPException(status_code=401, detail="Authentication required")
    
    payload = decode_token(auth_token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    db = get_database()
    paper = await db.papers.find_one({
        "_id": ObjectId(paper_id),
        "user_id": payload["sub"]
    })
    
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    
    try:
        doc = fitz.open(paper["file_path"])
        
        if page_num < 0 or page_num >= len(doc):
            raise HTTPException(status_code=400, detail="Invalid page number")
        
        page = doc[page_num]
        page_rect = page.rect
        
        # Convert normalized coordinates to absolute
        clip_rect = fitz.Rect(
            page_rect.x0 + x0 * page_rect.width,
            page_rect.y0 + y0 * page_rect.height,
            page_rect.x0 + x1 * page_rect.width,
            page_rect.y0 + y1 * page_rect.height
        )
        
        # Render with scaling
        mat = fitz.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=mat, clip=clip_rect)
        
        image_data = pix.tobytes("png")
        doc.close()
        
        return Response(
            content=image_data,
            media_type="image/png",
            headers={"Cache-Control": "max-age=3600"}
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{paper_id}")
async def delete_paper(paper_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a paper."""
    db = get_database()
    
    paper = await db.papers.find_one({
        "_id": ObjectId(paper_id),
        "user_id": current_user["id"]
    })
    
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    
    if os.path.exists(paper["file_path"]):
        os.remove(paper["file_path"])
    
    await db.highlights.delete_many({"paper_id": paper_id})
    await db.explanations.delete_many({"paper_id": paper_id})
    await db.canvases.delete_many({"paper_id": paper_id})
    await db.papers.delete_one({"_id": ObjectId(paper_id)})
    
    return {"message": "Paper deleted"}