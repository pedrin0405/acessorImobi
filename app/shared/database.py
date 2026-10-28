"""
Camada de acesso ao banco de dados.
- Pool de conexões asyncpg via SQLAlchemy async
- Injeção obrigatória de tenant_id via SET LOCAL (RLS)
- Toda sessão tem tenant_id definido — consultas sem tenant falham na RLS
"""
from contextlib import asynccontextmanager
from typing import AsyncIterator
from uuid import UUID

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.shared.config import get_settings

settings = get_settings()

engine = create_async_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    echo=settings.environment == "development",
)

# Sessões usadas pelo worker (sem pool, para evitar conflito com asyncpg)
engine_worker = create_async_engine(
    settings.database_url,
    poolclass=NullPool,
    echo=False,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)

AsyncSessionWorker = async_sessionmaker(
    engine_worker,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


@asynccontextmanager
async def get_session(tenant_id: UUID) -> AsyncIterator[AsyncSession]:
    """
    Context manager que fornece uma sessão com RLS configurado para o tenant.
    OBRIGATÓRIO passar tenant_id — nunca chamar sem ele.
    """
    async with AsyncSessionLocal() as session:
        # Configura a variável de sessão que a RLS usa para filtrar os dados
        await session.execute(
            f"SET LOCAL app.tenant_id = '{tenant_id}'"
        )
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


@asynccontextmanager
async def get_admin_session() -> AsyncIterator[AsyncSession]:
    """
    Sessão sem filtro de tenant — uso EXCLUSIVO para o painel de desenvolvedor
    e tarefas de provisionamento. Nunca expor nas rotas de corretor ou imobiliária.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
