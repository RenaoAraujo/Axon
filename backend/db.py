import json
import sqlite3
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

# Caminho para o arquivo app.db na raiz do projeto
DB_PATH = Path(__file__).resolve().parent.parent / "app.db"


def get_connection() -> sqlite3.Connection:
	"""
	Retorna uma conexão SQLite com configurações apropriadas.
	"""
	conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
	conn.row_factory = sqlite3.Row
	# Habilita suporte a chaves estrangeiras (por padrão vem desativado no SQLite)
	conn.execute("PRAGMA foreign_keys = ON;")
	return conn


def init_db() -> None:
	"""
	Cria as tabelas necessárias se ainda não existirem.
	- projects: armazena projetos como JSON (id como string)
	- inventory_items: armazena itens do inventário como JSON (id como string)
	- planner_state: armazena o estado do planner (linha única, chave 'state')
	- calendar_events: armazena eventos do calendário como JSON (id como string)
	- notes: armazena notas como JSON (id como string)
	"""
	with get_connection() as conn:
		conn.executescript(
			"""
			CREATE TABLE IF NOT EXISTS projects (
				id TEXT PRIMARY KEY,
				data TEXT NOT NULL,
				updated_at INTEGER DEFAULT (strftime('%s','now'))
			);
			
			CREATE TABLE IF NOT EXISTS inventory_items (
				id TEXT PRIMARY KEY,
				data TEXT NOT NULL,
				updated_at INTEGER DEFAULT (strftime('%s','now'))
			);
			
			CREATE TABLE IF NOT EXISTS planner_state (
				key TEXT PRIMARY KEY,
				data TEXT NOT NULL,
				updated_at INTEGER DEFAULT (strftime('%s','now'))
			);
			
			CREATE TABLE IF NOT EXISTS calendar_events (
				id TEXT PRIMARY KEY,
				data TEXT NOT NULL,
				updated_at INTEGER DEFAULT (strftime('%s','now'))
			);
			
			CREATE TABLE IF NOT EXISTS notes (
				id TEXT PRIMARY KEY,
				data TEXT NOT NULL,
				updated_at INTEGER DEFAULT (strftime('%s','now'))
			);
			"""
		)


def _upsert(conn: sqlite3.Connection, table: str, key_column: str, key_value: str, payload: Dict[str, Any]) -> None:
	conn.execute(
		f"""
		INSERT INTO {table} ({key_column}, data, updated_at)
		VALUES (?, ?, strftime('%s','now'))
		ON CONFLICT({key_column}) DO UPDATE SET
			data = excluded.data,
			updated_at = excluded.updated_at
		""",
		(key_value, json.dumps(payload, ensure_ascii=False)),
	)


def bulk_upsert_json(table: str, items: Iterable[Dict[str, Any]], id_key: str = "id") -> Tuple[int, List[str]]:
	"""
	Insere/atualiza em lote uma coleção de objetos JSON.
	Retorna (count_ok, ids_ok).
	"""
	count = 0
	ok_ids: List[str] = []
	# Converter para lista para evitar problemas com iteráveis consumidos
	items_list = list(items) if not isinstance(items, list) else items
	print(f"[DB] Iniciando bulk_upsert_json para tabela '{table}' com {len(items_list)} itens")
	conn = get_connection()
	print(f"[DB] Conexão estabelecida com banco: {DB_PATH}")
	try:
		for obj in items_list:
			if not isinstance(obj, dict):
				print(f"[DB] Objeto ignorado (não é dict): {type(obj)}")
				continue
			obj_id = obj.get(id_key)
			if not obj_id:
				print(f"[DB] Objeto ignorado (sem {id_key}): {list(obj.keys())[:5] if obj else 'vazio'}")
				continue
			print(f"[DB] Salvando {table} id={obj_id}, nome={obj.get('name', 'N/A')[:30]}")
			_upsert(conn, table, "id", str(obj_id), obj)
			count += 1
			ok_ids.append(str(obj_id))
		print(f"[DB] Antes do commit: {count} itens processados")
		conn.commit()  # Commit explícito
		print(f"[DB] ✅ Commit realizado: {count} itens salvos em {table}")
		
		# Verificar se realmente salvou
		cur = conn.cursor()
		cur.execute(f"SELECT COUNT(*) FROM {table}")
		total = cur.fetchone()[0]
		print(f"[DB] Verificação: {total} itens na tabela {table} após commit")
	except Exception as e:
		conn.rollback()  # Rollback em caso de erro
		print(f"[DB] ❌ Erro ao salvar: {e}")
		import traceback
		traceback.print_exc()
		raise e
	finally:
		conn.close()
	return count, ok_ids


def upsert_singleton_state(key: str, data: Dict[str, Any]) -> None:
	"""
	Salva um JSON único em planner_state com a chave fornecida (ex: 'state').
	"""
	with get_connection() as conn:
		conn.execute(
			"""
			INSERT INTO planner_state (key, data, updated_at)
			VALUES (?, ?, strftime('%s','now'))
			ON CONFLICT(key) DO UPDATE SET
				data = excluded.data,
				updated_at = excluded.updated_at
			""",
			(key, json.dumps(data, ensure_ascii=False)),
		)


def get_all_json(table: str) -> List[Dict[str, Any]]:
	with get_connection() as conn:
		cur = conn.execute(f"SELECT data FROM {table}")
		rows = cur.fetchall()
		return [json.loads(r["data"]) for r in rows]


def get_singleton_state(key: str) -> Optional[Dict[str, Any]]:
	with get_connection() as conn:
		cur = conn.execute("SELECT data FROM planner_state WHERE key = ?", (key,))
		row = cur.fetchone()
		return json.loads(row["data"]) if row else None


