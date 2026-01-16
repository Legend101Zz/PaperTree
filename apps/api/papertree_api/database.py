from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from papertree_api.config import get_settings

settings = get_settings()

client: AsyncIOMotorClient = None
db: AsyncIOMotorDatabase = None


async def connect_to_mongo():
    """Connect to MongoDB on application startup."""
    global client, db
    client = AsyncIOMotorClient(settings.mongo_uri)
    db = client[settings.database_name]
    
    # Create indexes
    await db.users.create_index("email", unique=True)
    await db.papers.create_index("user_id")
    await db.paper_images.create_index([("paper_id", 1), ("user_id", 1)])  # NEW
    await db.highlights.create_index([("paper_id", 1), ("user_id", 1)])
    await db.explanations.create_index([("paper_id", 1), ("highlight_id", 1)])
    await db.canvases.create_index([("paper_id", 1), ("user_id", 1)], unique=True)
    
    print("Connected to MongoDB")


async def close_mongo_connection():
    """Close MongoDB connection on application shutdown."""
    global client
    if client:
        client.close()
        print("Closed MongoDB connection")


def get_database() -> AsyncIOMotorDatabase:
    """Get database instance."""
    return db