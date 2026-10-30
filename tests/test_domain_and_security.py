import hashlib
import json
import pytest
from app.shared.phone import normalize_phone
from app.shared.security import (
    encrypt_credentials,
    decrypt_credentials,
    hash_password,
    verify_password,
    mask_phone,
    hash_email,
    create_access_token,
    decode_access_token,
)


def test_normalize_phone():
    # Telefones brasileiros válidos
    assert normalize_phone("31999998888") == "+5531999998888"
    assert normalize_phone("+55 31 99999-8888") == "+5531999998888"
    assert normalize_phone("(11) 98765-4321") == "+5511987654321"

    # Formato móvel legado, ainda usado em JIDs antigos do WhatsApp
    assert normalize_phone("556392185349") == "+5563992185349"
    assert normalize_phone("6392185349") == "+5563992185349"

    # Telefone fixo com 8 dígitos não recebe o nono dígito
    assert normalize_phone("553332123456") == "+553332123456"

    # Telefone inválido deve levantar ValueError
    with pytest.raises(ValueError):
        normalize_phone("123")


def test_aes_credentials_encryption_decryption(monkeypatch):
    # Simula chave hex de 32 bytes
    monkeypatch.setenv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
    from app.shared.config import get_settings
    get_settings.cache_clear()

    payload = json.dumps({"chave": "secret_imoview_api_key", "base_url": "https://api.imoview.com.br"})
    encrypted = encrypt_credentials(payload)
    assert isinstance(encrypted, bytes)
    assert encrypted != payload.encode()

    decrypted = decrypt_credentials(encrypted)
    assert decrypted == payload


def test_password_hashing():
    senha = "MinhaSenhaForte123!"
    hashed = hash_password(senha)
    assert hashed != senha
    assert verify_password(senha, hashed) is True
    assert verify_password("SenhaErrada", hashed) is False


def test_mask_phone_and_hash_email():
    assert mask_phone("+5531999998888") == "+55***88"
    hashed = hash_email("corretor@imobiliaria.com.br")
    assert hashed.startswith("sha:")
    assert len(hashed) == 16


def test_jwt_tokens(monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "test_secret_key_64_bytes_hex_padded_padded_padded_padded_padded_1234")
    from app.shared.config import get_settings
    get_settings.cache_clear()

    token = create_access_token(subject="user123", role="corretor")
    payload = decode_access_token(token)
    assert payload["sub"] == "user123"
    assert payload["role"] == "corretor"
