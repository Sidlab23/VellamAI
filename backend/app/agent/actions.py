"""
Defines every action the agent can take.
Actions that touch a browser are stubbed here — Part 3 wires in Playwright.
"""

from enum import Enum
from typing import Any
from pydantic import BaseModel


class ActionName(str, Enum):
    NAVIGATE = "navigate"
    SEARCH = "search"
    CLICK = "click"
    TYPE = "type"
    EXTRACT = "extract"
    SCROLL = "scroll"
    WAIT = "wait"
    ASK_APPROVAL = "ask_approval"
    DONE = "done"
    THINK = "think"  # No-op reasoning step


# Actions that require human approval before execution
SENSITIVE_ACTIONS = {
    "checkout",
    "purchase",
    "buy",
    "pay",
    "submit_application",
    "create_account",
    "send_message",
    "delete",
}


class ParsedAction(BaseModel):
    thought: str
    action: str
    action_input: dict[str, Any]
    raw: str  # original LLM output

    @property
    def is_terminal(self) -> bool:
        return self.action in (ActionName.DONE, ActionName.ASK_APPROVAL)

    @property
    def needs_browser(self) -> bool:
        return self.action in (
            ActionName.NAVIGATE,
            ActionName.CLICK,
            ActionName.TYPE,
            ActionName.EXTRACT,
            ActionName.SCROLL,
        )
