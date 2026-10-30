"""
Armazenamento das mídias das conversas (áudios) no MinIO.

A referência gravada em `mensagens.midia_url` é `s3:<chave>`; o arquivo só sai
pela rota autenticada do portal, nunca por URL pública.
"""
import asyncio
import io
from functools import lru_cache
from typing import Optional, Tuple
from uuid import UUID, uuid4

import structlog
from minio import Minio
from minio.error import S3Error

from app.shared.config import get_settings

log = structlog.get_logger()
settings = get_settings()

PREFIXO_S3 = "s3:"


@lru_cache(maxsize=1)
def _cliente() -> Minio:
    return Minio(
        settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=settings.minio_secure,
    )


def _enviar(chave: str, dados: bytes, content_type: str) -> None:
    cliente = _cliente()
    bucket = settings.minio_bucket_audios
    if not cliente.bucket_exists(bucket):
        cliente.make_bucket(bucket)
    cliente.put_object(bucket, chave, io.BytesIO(dados), len(dados), content_type=content_type)


async def guardar_midia(
    tenant_id: UUID, corretor_id: UUID, dados: bytes, extensao: str, content_type: str
) -> Optional[str]:
    """Grava o arquivo e devolve a referência `s3:<chave>`; None se o storage falhar."""
    chave = f"{tenant_id}/{corretor_id}/{uuid4().hex}.{extensao}"
    try:
        await asyncio.to_thread(_enviar, chave, dados, content_type)
    except Exception as e:  # noqa: BLE001 - guardar a mídia nunca pode derrubar a resposta
        log.warning("midia_nao_guardada", error=str(e)[:200])
        return None
    return PREFIXO_S3 + chave


def _ler(chave: str) -> Tuple[bytes, str]:
    resposta = _cliente().get_object(settings.minio_bucket_audios, chave)
    try:
        return resposta.read(), resposta.headers.get("Content-Type") or "application/octet-stream"
    finally:
        resposta.close()
        resposta.release_conn()


async def ler_midia(referencia: str) -> Optional[Tuple[bytes, str]]:
    """Conteúdo e content-type da referência `s3:<chave>`; None se não existir."""
    if not referencia.startswith(PREFIXO_S3):
        return None
    try:
        return await asyncio.to_thread(_ler, referencia[len(PREFIXO_S3):])
    except S3Error as e:
        log.warning("midia_nao_encontrada", codigo=e.code)
        return None


async def guardar_objeto(chave: str, dados: bytes, content_type: str) -> Optional[str]:
    """Grava com chave fixa (sobrescreve) e devolve `s3:<chave>`; None se o storage falhar."""
    try:
        await asyncio.to_thread(_enviar, chave, dados, content_type)
    except Exception as e:  # noqa: BLE001
        log.warning("objeto_nao_guardado", error=str(e)[:200])
        return None
    return PREFIXO_S3 + chave
