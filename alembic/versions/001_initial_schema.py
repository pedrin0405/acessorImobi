"""Initial schema baseline

Revision ID: 001_initial_schema
Revises: 
Create Date: 2026-10-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '001_initial_schema'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # O esquema completo é inicializado deterministicamente pelo infra/postgres/init.sql
    # no momento de subida dos containers Postgres. Esta migration marca o baseline.
    pass


def downgrade() -> None:
    pass
