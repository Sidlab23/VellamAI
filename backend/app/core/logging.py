import logging
import sys
from pathlib import Path

import structlog


def setup_logging(log_level: str = "INFO", log_file: str = "logs/app.log") -> None:
    Path(log_file).parent.mkdir(parents=True, exist_ok=True)

    log_level_int = getattr(logging, log_level.upper(), logging.INFO)

    # Standard library logging — captures uvicorn and sqlalchemy output
    handlers: list[logging.Handler] = [logging.StreamHandler(sys.stdout)]
    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    handlers.append(file_handler)

    logging.basicConfig(
        level=log_level_int,
        format="%(message)s",
        handlers=handlers,
    )

    # Structlog processors
    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
    ]

    structlog.configure(
        processors=shared_processors
        + [
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        processor=structlog.dev.ConsoleRenderer() if log_level_int == logging.DEBUG
        else structlog.processors.JSONRenderer(),
        foreign_pre_chain=shared_processors,
    )

    for handler in handlers:
        handler.setFormatter(formatter)


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)
