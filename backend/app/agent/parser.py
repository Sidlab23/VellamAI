"""
Parse raw LLM text output into a structured ParsedAction.

LLMs don't always follow format instructions perfectly, so this parser
tries multiple strategies before falling back gracefully.
"""

import json
import re

from app.agent.actions import ParsedAction
from app.core.logging import get_logger

logger = get_logger(__name__)

# Regex patterns — order matters (most specific first)
_THOUGHT_RE = re.compile(r"Thought\s*:\s*(.*?)(?=Action\s*:|$)", re.DOTALL | re.IGNORECASE)
_ACTION_RE = re.compile(r"Action\s*:\s*([a-zA-Z_]+)", re.IGNORECASE)
_INPUT_RE = re.compile(r"Action\s+Input\s*:\s*(\{.*?\})\s*$", re.DOTALL | re.IGNORECASE)
_INPUT_BLOCK_RE = re.compile(r"Action\s+Input\s*:\s*(.*?)$", re.DOTALL | re.IGNORECASE)


def _extract_json(text: str) -> dict:
    """Try to extract a JSON object from a string, with multiple fallback strategies."""
    text = text.strip()

    # Strategy 1: direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Strategy 2: find first {...} block
    match = re.search(r"\{.*?\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass

    # Strategy 3: find last {...} block (sometimes LLM adds explanation after)
    matches = list(re.finditer(r"\{.*?\}", text, re.DOTALL))
    if matches:
        try:
            return json.loads(matches[-1].group(0))
        except json.JSONDecodeError:
            pass

    # Strategy 4: try fixing common issues (trailing commas, single quotes)
    cleaned = text.replace("'", '"')
    cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    logger.warning("json_parse_failed", raw=text[:200])
    return {"raw_input": text}


def parse_react_response(text: str) -> ParsedAction:
    """
    Parse a ReAct-format LLM response into a ParsedAction.

    Expected format:
        Thought: <reasoning>
        Action: <action_name>
        Action Input: {"key": "value"}
    """
    thought = ""
    action = "done"
    action_input: dict = {}

    # Extract Thought
    thought_match = _THOUGHT_RE.search(text)
    if thought_match:
        thought = thought_match.group(1).strip()
    else:
        # Fallback: use entire text as thought
        thought = text.strip()

    # Extract Action
    action_match = _ACTION_RE.search(text)
    if action_match:
        action = action_match.group(1).strip().lower()

    # Extract Action Input
    input_match = _INPUT_RE.search(text)
    if input_match:
        action_input = _extract_json(input_match.group(1))
    else:
        # Try looser match
        loose_match = _INPUT_BLOCK_RE.search(text)
        if loose_match:
            action_input = _extract_json(loose_match.group(1))

    # If no thought was parsed but we have text, use it
    if not thought and text:
        thought = f"[Could not parse thought from: {text[:100]}...]"

    # If action is unknown, default to done with the raw text as result
    known_actions = {
        "navigate", "search", "click", "type", "extract",
        "scroll", "wait", "think", "ask_approval", "done",
    }
    if action not in known_actions:
        logger.warning("unknown_action_parsed", action=action, raw=text[:200])
        action = "done"
        action_input = {"result": text.strip(), "summary": "Agent produced unrecognized action"}

    return ParsedAction(
        thought=thought,
        action=action,
        action_input=action_input,
        raw=text,
    )
