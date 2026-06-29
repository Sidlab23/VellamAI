"""
User profile endpoints — the agent's local "memory" of the user.

A small set of editable, non-task-specific facts (name, city, sizes, preferences…)
that the agent reuses on every run so the user doesn't keep repeating themselves.
Stored in the encrypted vault (it can include an address/contact), never sent
anywhere except into the local model's prompt at run time.
"""

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services import vault_service

router = APIRouter(prefix="/profile", tags=["profile"])


class Profile(BaseModel):
    name: str = Field("", max_length=200)
    email: str = Field("", max_length=320)
    phone: str = Field("", max_length=50)
    city: str = Field("", max_length=200)
    address: str = Field("", max_length=1000)


@router.get("", response_model=Profile, summary="Get the user's saved profile")
async def get_profile() -> Profile:
    # Extra/old keys in storage are ignored; missing fields default to "".
    return Profile(**vault_service.get_profile())


@router.put("", response_model=Profile, summary="Save the user's profile")
async def put_profile(body: Profile) -> Profile:
    saved = vault_service.set_profile(body.model_dump())
    return Profile(**saved)
