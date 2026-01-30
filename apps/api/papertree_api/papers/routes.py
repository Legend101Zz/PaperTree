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

from .llm_service import (extract_page_text, generate_book_content,
                          generate_multiple_pages)
from .models import (BookContent, GenerateBookContentRequest,
                     GeneratePagesRequest, PageSummary, PaperDetailResponse,
                     PaperResponse, PDFRegion, SearchResult, SmartOutlineItem)

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
        "book_content": None,
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
    """Generate book content for a paper (page-by-page)."""
    import traceback
    
    db = get_database()
    try:
        paper = await db.papers.find_one({
            "_id": ObjectId(paper_id),
            "user_id": current_user["id"]
        })
    except Exception as e:
        raise HTTPException(status_code=404, detail="Paper not found")
    
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    
    # Check if already generated and not forcing regeneration
    if paper.get("book_content") and not request.force_regenerate:
        return {"message": "Book content already exists", "status": "exists"}
    
    extracted_text = paper.get("extracted_text", "")
    page_count = paper.get("page_count", 1)
    title = paper.get("title", "Untitled")
    
    if not extracted_text:
        raise HTTPException(status_code=400, detail="No text extracted from PDF")
    
    print(f"Generating book content for paper {paper_id}")
    print(f"Text length: {len(extracted_text)}, Page count: {page_count}")
    
    try:
        # Determine pages to generate
        if request.generate_all:
            default_pages = page_count
        elif request.pages:
            default_pages = len(request.pages)
        else:
            default_pages = 5  # Default: first 5 pages
        
        result = await generate_book_content(
            paper_text=extracted_text,
            page_count=page_count,
            title=title,
            default_pages=default_pages
        )
        
        # Build smart outline from page summaries
        smart_outline = []
        for ps in result.get("page_summaries", []):
            smart_outline.append({
                "id": f"page-{ps['page']}",
                "title": ps["title"],
                "level": 1,
                "section_id": f"page-{ps['page']}",
                "pdf_page": ps["page"],
                "description": ps["key_concepts"][0] if ps.get("key_concepts") else None
            })
        
        # Store in database
        await db.papers.update_one(
            {"_id": ObjectId(paper_id)},
            {"$set": {
                "book_content": result,
                "smart_outline": smart_outline
            }}
        )
        
        return {"message": "Book content generated", "status": "success", "pages_generated": len(result.get("page_summaries", []))}
        
    except Exception as e:
        print(f"Error generating book content: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{paper_id}/generate-pages")
async def generate_pages(
    paper_id: str,
    request: GeneratePagesRequest,
    current_user: dict = Depends(get_current_user)
):
    """Generate summaries for specific pages."""
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
    
    extracted_text = paper.get("extracted_text", "")
    page_count = paper.get("page_count", 1)
    book_content = paper.get("book_content", {})
    
    if not extracted_text:
        raise HTTPException(status_code=400, detail="No text extracted from PDF")
    
    # Filter out already generated pages
    existing_pages = set()
    if book_content and book_content.get("page_summaries"):
        existing_pages = {ps["page"] for ps in book_content["page_summaries"]}
    
    pages_to_generate = [p for p in request.pages if p not in existing_pages and 0 <= p < page_count]
    
    if not pages_to_generate:
        return {"message": "All requested pages already generated", "pages_generated": 0}
    
    try:
        new_summaries = await generate_multiple_pages(
            full_text=extracted_text,
            total_pages=page_count,
            pages_to_generate=pages_to_generate
        )
        
        # Merge with existing summaries
        all_summaries = list(book_content.get("page_summaries", []))
        all_summaries.extend(new_summaries)
        all_summaries.sort(key=lambda x: x["page"])
        
        # Update summary status
        generated_pages = [ps["page"] for ps in all_summaries]
        summary_status = {
            "total_pages": page_count,
            "generated_pages": generated_pages,
            "default_limit": book_content.get("summary_status", {}).get("default_limit", 5)
        }
        
        # Update smart outline
        smart_outline = []
        for ps in all_summaries:
            smart_outline.append({
                "id": f"page-{ps['page']}",
                "title": ps["title"],
                "level": 1,
                "section_id": f"page-{ps['page']}",
                "pdf_page": ps["page"],
                "description": ps["key_concepts"][0] if ps.get("key_concepts") else None
            })
        
        # Save to database
        await db.papers.update_one(
            {"_id": ObjectId(paper_id)},
            {"$set": {
                "book_content.page_summaries": all_summaries,
                "book_content.summary_status": summary_status,
                "smart_outline": smart_outline
            }}
        )
        
        return {
            "message": "Pages generated",
            "status": "success",
            "pages_generated": len(new_summaries),
            "new_summaries": new_summaries
        }
        
    except Exception as e:
        print(f"Error generating pages: {e}")
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
    x0: float = 0,
    y0: float = 0,
    x1: float = 1,
    y1: float = 1,
    scale: float = 2.0
):
    """Get a region of a PDF page as an image."""
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
        
        clip_rect = fitz.Rect(
            page_rect.x0 + x0 * page_rect.width,
            page_rect.y0 + y0 * page_rect.height,
            page_rect.x0 + x1 * page_rect.width,
            page_rect.y0 + y1 * page_rect.height
        )
        
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