"""
Segurança: JWT, hashing de senhas e criptografia AES-256 para credenciais por tenant.
"""
import base64
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.shared.config import get_settings

settings = get_settings()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ALGORITHM = "HS256"


# --- JWT ---

def create_access_token(
    subject: str,
    tenant_id: Optional[UUID] = None,
    role: str = "corretor",
    expires_delta: Optional[timedelta] = None,
    corretor_id: Optional[UUID] = None,
    admin_id: Optional[UUID] = None,
) -> str:
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    )
    payload = {
        "sub": subject,
        "exp": expire,
        "role": role,
    }
    if tenant_id:
        payload["tid"] = str(tenant_id)
    if corretor_id:
        payload["cid"] = str(corretor_id)
    if admin_id:
        payload["aid"] = str(admin_id)
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    except JWTError as e:
        raise InvalidTokenError(str(e)) from e


class InvalidTokenError(Exception):
    pass


# --- Senhas ---

def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# --- AES-256-GCM para credenciais Imoview por tenant ---

def _get_aes_key() -> bytes:
    """Deriva a chave AES a partir de ENCRYPTION_KEY (hex string de 32 bytes)."""
    return bytes.fromhex(settings.encryption_key)


def encrypt_credentials(plaintext: str) -> bytes:
    """Cifra credenciais sensíveis (ex: chave de API Imoview) para armazenar no banco."""
    key = _get_aes_key()
    aesgcm = AESGCM(key)
    import os
    nonce = os.urandom(12)  # 96-bit nonce para GCM
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode(), None)
    # Formato: nonce(12) + ciphertext
    return nonce + ciphertext


def decrypt_credentials(data: bytes) -> str:
    """Decifra credenciais. Lança ValueError se o dado for inválido ou adulterado."""
    key = _get_aes_key()
    aesgcm = AESGCM(key)
    nonce, ciphertext = data[:12], data[12:]
    try:
        return aesgcm.decrypt(nonce, ciphertext, None).decode()
    except Exception as e:
        raise ValueError("Falha ao decifrar credenciais") from e


# --- Utilitários ---

def mask_phone(phone: str) -> str:
    """Mascara telefone para logs — nunca loga número completo em produção."""
    if len(phone) < 5:
        return "***"
    return phone[:3] + "***" + phone[-2:]


def hash_email(email: str) -> str:
    """Hash de email para logs — nunca loga email em produção."""
    import hashlib
    return "sha:" + hashlib.sha256(email.lower().encode()).hexdigest()[:12]
