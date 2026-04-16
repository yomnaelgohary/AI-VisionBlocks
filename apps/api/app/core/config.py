from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path

class Settings(BaseSettings):
    API_TITLE: str = "VisionBlocks API"
    API_VERSION: str = "0.1.0"

    # Where datasets live 
    DATASETS_DIR: Path = Path(__file__).resolve().parent.parent / "data" / "datasets"

    # Image preview max side (px)
    PREVIEW_MAX_SIDE: int = 512

    model_config = SettingsConfigDict(env_file=".env", extra="allow")

settings = Settings()
