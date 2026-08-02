from datetime import datetime

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status
from papertree_api.database import get_database

from .models import TokenResponse, UserCreate, UserLogin, UserResponse
from .utils import (create_access_token, get_current_user, hash_password,
                    verify_password)

router = APIRouter()


@router.post("/register", response_model=TokenResponse)
async def register(user_data: UserCreate):
    """
    Register a new user.
    Returns JWT token on successful registration.
    """
    db = get_database()
    
    # Check if user already exists
    existing_user = await db.users.find_one({"email": user_data.email})
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Create new user
    user_doc = {
        "email": user_data.email,
        "password_hash": hash_password(user_data.password),
        "created_at": datetime.utcnow()
    }
    
    result = await db.users.insert_one(user_doc)
    user_id = str(result.inserted_id)
    
    # Generate token
    access_token = create_access_token(user_id, user_data.email)
    
    return TokenResponse(access_token=access_token)


@router.post("/login", response_model=TokenResponse)
async def login(user_data: UserLogin):
    """
    Login with email and password.
    Returns JWT token on successful login.
    """
    db = get_database()
    
    # Find user
    user = await db.users.find_one({"email": user_data.email})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    
    # Verify password
    if not verify_password(user_data.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    
    # Generate token
    user_id = str(user["_id"])
    access_token = create_access_token(user_id, user["email"])
    
    return TokenResponse(access_token=access_token)


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: dict = Depends(get_current_user)):
    """
    Get current authenticated user's information.
    """
    db = get_database()
    user = await db.users.find_one({"_id": ObjectId(current_user["id"])})
    
    return UserResponse(
        id=str(user["_id"]),
        email=user["email"],
        created_at=user["created_at"]
    )