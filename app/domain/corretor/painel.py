"""Painel do corretor no portal: dados, números e preferências num só lugar."""
import json
import re
from typing import Any, Dict, Optional
from uuid import UUID

from sqlalchemy import text

from app.domain.corretor import foto as foto_corretor
from app.domain.whatsapp.corretor import ASSISTENTE_PADRAO, config_assistente
from app.shared.security import mask_phone


class PainelErro(ValueError):
    pass


async def montar(session, tenant_id: UUID, corretor_id: UUID) -> Optional[Dict[str, Any]]:
    tid, cid = str(tenant_id), str(corretor_id)
    c = (await session.execute(text("SELECT * FROM corretores WHERE id = :id AND tenant_id = :tid"), {"id": cid, "tid": tid})).first()
    if not c:
        return None
    um = lambda sql: session.execute(text(sql), {"tid": tid, "cid": cid})  # noqa: E731
    carteira = (await um("""
        SELECT (SELECT COUNT(*) FROM crm_leads WHERE tenant_id = :tid AND corretor_id = :cid AND status <> 'arquivado') AS clientes,
               (SELECT COUNT(*) FROM crm_leads WHERE tenant_id = :tid AND corretor_id = :cid AND status <> 'arquivado' AND temperatura = 'quente') AS quentes,
               (SELECT COUNT(*) FROM crm_negocios WHERE tenant_id = :tid AND corretor_id = :cid AND status = 'aberto') AS negocios_abertos,
               (SELECT COALESCE(SUM(valor), 0) FROM crm_negocios WHERE tenant_id = :tid AND corretor_id = :cid AND status = 'aberto') AS valor_aberto,
               (SELECT COUNT(*) FROM crm_negocios WHERE tenant_id = :tid AND corretor_id = :cid AND status = 'ganho') AS negocios_ganhos,
               (SELECT COUNT(*) FROM crm_atividades WHERE tenant_id = :tid AND corretor_id = :cid AND status = 'aberta') AS atividades_abertas,
               (SELECT COUNT(*) FROM crm_atividades WHERE tenant_id = :tid AND corretor_id = :cid AND status = 'aberta' AND inicio < NOW()) AS atrasadas
    """)).first()
    msgs = (await um("""
        SELECT COUNT(*) FILTER (WHERE direcao = 'inbound') AS recebidas, COUNT(*) FILTER (WHERE direcao = 'outbound') AS enviadas,
               MAX(created_at) AS ultima
        FROM mensagens WHERE tenant_id = :tid AND corretor_id = :cid AND created_at > NOW() - INTERVAL '30 days'
    """)).first()
    aguardando = (await um("SELECT COUNT(*) FROM atendimentos WHERE tenant_id = :tid AND corretor_id = :cid AND aguardando_corretor")).scalar() or 0
    sessao = (await um("SELECT status, numero, last_seen FROM whatsapp_sessions WHERE tenant_id = :tid AND corretor_id = :cid")).first()
    roleta = ((await session.execute(text("SELECT dados->'roleta' FROM tenants WHERE id = :tid"), {"tid": tid})).scalar()) or {}
    iso = lambda v: v.isoformat() if v else None  # noqa: E731
    return {
        "id": cid, "nome": c.nome, "email": c.email, "telefone": c.telefone, "telefone_mascarado": mask_phone(c.telefone),
        "status": c.status, "recusa_motivo": c.recusa_motivo, "criado_em": iso(c.created_at), "aprovado_em": iso(c.aprovado_em),
        "foto_url": foto_corretor.url_da_foto(c.id, c.foto_ref, c.foto_atualizada_em), "foto_origem": c.foto_origem,
        "assistente": config_assistente(c.assistente_config),
        "whatsapp_pessoal": {"status": sessao.status if sessao else "disconnected", "numero": sessao.numero if sessao else None,
                             "visto_em": iso(sessao.last_seen) if sessao else None},
        "roleta": {"ativa": bool(roleta.get("ativa")), "participa": cid in [str(p) for p in (roleta.get("participantes") or [])]},
        "carteira": {k: (float(v) if k == "valor_aberto" else int(v or 0)) for k, v in carteira._mapping.items()},
        "atividade": {"recebidas_30d": int(msgs.recebidas or 0), "enviadas_30d": int(msgs.enviadas or 0), "ultima_mensagem_em": iso(msgs.ultima),
                      "aguardando_resposta": int(aguardando)},
    }


async def atualizar_dados(session, tenant_id: UUID, corretor_id: UUID, nome: Optional[str], email: Optional[str]) -> None:
    sets, params = [], {"id": str(corretor_id), "tid": str(tenant_id)}
    if nome is not None:
        nome = " ".join(nome.split())
        if len(nome) < 2 or len(nome) > 255:
            raise PainelErro("Informe o nome completo do corretor.")
        sets.append("nome = :nome")
        params["nome"] = nome
    if email is not None:
        email = email.strip()
        if email and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            raise PainelErro("E-mail inválido.")
        sets.append("email = :email")
        params["email"] = email or None
    if sets:
        await session.execute(text(f"UPDATE corretores SET {', '.join(sets)} WHERE id = :id AND tenant_id = :tid"), params)


async def salvar_assistente(session, tenant_id: UUID, corretor_id: UUID, config: Dict[str, Any]) -> Dict[str, bool]:
    limpo = {k: bool(config.get(k, v)) for k, v in ASSISTENTE_PADRAO.items()}
    await session.execute(
        text("UPDATE corretores SET assistente_config = CAST(:c AS jsonb) WHERE id = :id AND tenant_id = :tid"),
        {"c": json.dumps(limpo), "id": str(corretor_id), "tid": str(tenant_id)},
    )
    return limpo


async def definir_roleta(session, tenant_id: UUID, corretor_id: UUID, participa: bool) -> None:
    atual = ((await session.execute(text("SELECT dados->'roleta' FROM tenants WHERE id = :tid"), {"tid": str(tenant_id)})).scalar()) or {}
    participantes = [str(p) for p in (atual.get("participantes") or []) if str(p) != str(corretor_id)]
    if participa:
        participantes.append(str(corretor_id))
    novo = {**atual, "participantes": participantes}
    await session.execute(
        text("UPDATE tenants SET dados = jsonb_set(COALESCE(dados, '{}'::jsonb), '{roleta}', CAST(:v AS jsonb), true) WHERE id = :tid"),
        {"v": json.dumps(novo), "tid": str(tenant_id)},
    )


async def definir_situacao(session, tenant_id: UUID, corretor_id: UUID, ativo: bool) -> str:
    atual = (await session.execute(text("SELECT status FROM corretores WHERE id = :id AND tenant_id = :tid"), {"id": str(corretor_id), "tid": str(tenant_id)})).scalar()
    if atual not in ("active", "blocked"):
        raise PainelErro("Só corretores já aprovados podem ser ativados ou bloqueados. Use a aprovação na lista.")
    novo = "active" if ativo else "blocked"
    await session.execute(text("UPDATE corretores SET status = :s WHERE id = :id AND tenant_id = :tid"), {"s": novo, "id": str(corretor_id), "tid": str(tenant_id)})
    return novo
