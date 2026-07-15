#!/usr/bin/env python3
"""
Memory Query CLI for auto-claude-ui.

Provides a subprocess interface for querying the LadybugDB/Graphiti memory database.
Called from Node.js (Electron main process) via child_process.spawn().

Usage:
    python query_memory.py get-status <db-path> <database>
    python query_memory.py get-memories <db-path> <database> [--limit N]
    python query_memory.py search <db-path> <database> <query> [--limit N]
    python query_memory.py semantic-search <db-path> <database> <query> [--limit N]
    python query_memory.py get-entities <db-path> <database> [--limit N]
    python query_memory.py get-relationships <db-path> <database> [--limit N]

Output:
    JSON to stdout with structure: {"success": bool, "data": ..., "error": ...}
"""

import argparse
import asyncio
import hashlib
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path


def compute_project_group_id(project_dir: str) -> str:
    """Compute the project-scoped group_id for a project directory.

    Replicates GraphitiMemory.group_id in PROJECT mode so the memory browser
    can scope queries to a single project. Format:
        project_{name}_{md5(resolve(project_dir))[:8]}

    Args:
        project_dir: Path to the project root directory.

    Returns:
        The project-scoped group_id string.
    """
    path = Path(project_dir)
    project_name = path.name
    path_hash = hashlib.md5(
        str(path.resolve()).encode(), usedforsecurity=False
    ).hexdigest()[:8]
    return f"project_{project_name}_{path_hash}"


def resolve_group_id(args) -> str | None:
    """Resolve the group_id filter from CLI args.

    Precedence:
        1. Explicit --group-id passthrough (used as-is)
        2. --project-dir (computed via compute_project_group_id)
        3. None (unscoped / backward compatible)

    Returns:
        The group_id to filter by, or None for unscoped queries.
    """
    group_id = getattr(args, "group_id", None)
    if group_id:
        return group_id
    project_dir = getattr(args, "project_dir", None)
    if project_dir:
        return compute_project_group_id(project_dir)
    return None


# Apply LadybugDB monkeypatch BEFORE any graphiti imports
def apply_monkeypatch():
    """Apply LadybugDB monkeypatch or use native kuzu.

    Tries LadybugDB first (for embedded usage), falls back to native kuzu.
    """
    try:
        import real_ladybug

        sys.modules["kuzu"] = real_ladybug
        return "ladybug"
    except ImportError:
        pass

    # Try native kuzu as fallback
    try:
        import kuzu  # noqa: F401

        return "kuzu"
    except ImportError:
        return None


def serialize_value(val):
    """Convert non-JSON-serializable types to strings."""
    if val is None:
        return None
    if hasattr(val, "isoformat"):
        return val.isoformat()
    if hasattr(val, "timestamp"):
        # kuzu Timestamp object
        return str(val)
    return val


def output_json(success: bool, data=None, error: str = None):
    """Output JSON result to stdout and exit."""
    result = {"success": success}
    if data is not None:
        result["data"] = data
    if error:
        result["error"] = error
    print(
        json.dumps(result, default=str)
    )  # Use default=str for any non-serializable types
    sys.exit(0 if success else 1)


def output_error(message: str):
    """Output error JSON and exit with failure."""
    output_json(False, error=message)


def get_db_connection(db_path: str, database: str):
    """Get a database connection."""
    try:
        # Try to import kuzu (might be real_ladybug via monkeypatch or native)
        try:
            import kuzu
        except ImportError:
            import real_ladybug as kuzu

        full_path = Path(db_path) / database
        if not full_path.exists():
            return None, f"Database not found at {full_path}"

        db = kuzu.Database(str(full_path))
        conn = kuzu.Connection(db)
        return conn, None
    except Exception as e:
        return None, str(e)


def cmd_get_status(args):
    """Get memory database status."""
    db_path = Path(args.db_path)
    database = args.database

    # Check if kuzu/LadybugDB is available
    db_backend = apply_monkeypatch()
    if not db_backend:
        output_json(
            True,
            data={
                "available": False,
                "ladybugInstalled": False,
                "databasePath": str(db_path),
                "database": database,
                "databaseExists": False,
                "message": "Neither kuzu nor LadybugDB is installed",
            },
        )
        return

    full_path = db_path / database
    db_exists = full_path.exists()

    # List available databases
    databases = []
    if db_path.exists():
        for item in db_path.iterdir():
            # Include both files and directories as potential databases
            if item.name.startswith("."):
                continue
            databases.append(item.name)

    # Try to connect and verify
    conn, error = get_db_connection(str(db_path), database)
    connected = conn is not None

    if connected:
        try:
            # Test query
            result = conn.execute("RETURN 1 as test")
            _ = result.get_as_df()
        except Exception as e:
            connected = False
            error = str(e)

    output_json(
        True,
        data={
            "available": True,
            "ladybugInstalled": True,
            "databasePath": str(db_path),
            "database": database,
            "databaseExists": db_exists,
            "connected": connected,
            "databases": databases,
            "error": error,
        },
    )


def cmd_get_memories(args):
    """Get episodic memories from the database."""
    if not apply_monkeypatch():
        output_error("Neither kuzu nor LadybugDB is installed")
        return

    conn, error = get_db_connection(args.db_path, args.database)
    if not conn:
        output_error(error or "Failed to connect to database")
        return

    try:
        limit = args.limit or 20
        group_id = resolve_group_id(args)

        # Optionally scope to a single project's group_id
        where_clause = "WHERE e.group_id = $group_id\n            " if group_id else ""

        # Query episodic nodes with parameterized query
        query = f"""
            MATCH (e:Episodic)
            {where_clause}RETURN e.uuid as uuid, e.name as name, e.created_at as created_at,
                   e.content as content, e.source_description as description,
                   e.group_id as group_id
            ORDER BY e.created_at DESC
            LIMIT $limit
        """

        parameters = {"limit": limit}
        if group_id:
            parameters["group_id"] = group_id
        result = conn.execute(query, parameters=parameters)

        # Process results without pandas (iterate through result set directly)
        memories = []
        while result.has_next():
            row = result.get_next()
            # Row order: uuid, name, created_at, content, description, group_id
            uuid_val = serialize_value(row[0]) if len(row) > 0 else None
            name_val = serialize_value(row[1]) if len(row) > 1 else ""
            created_at_val = serialize_value(row[2]) if len(row) > 2 else None
            content_val = serialize_value(row[3]) if len(row) > 3 else ""
            description_val = serialize_value(row[4]) if len(row) > 4 else ""
            group_id_val = serialize_value(row[5]) if len(row) > 5 else ""

            memory = {
                "id": uuid_val or name_val or "unknown",
                "name": name_val or "",
                "type": infer_episode_type(name_val or "", content_val or ""),
                "timestamp": created_at_val or datetime.now().isoformat(),
                "content": content_val or description_val or name_val or "",
                "description": description_val or "",
                "group_id": group_id_val or "",
            }

            # Extract session number if present
            session_num = extract_session_number(name_val or "")
            if session_num:
                memory["session_number"] = session_num

            memories.append(memory)

        output_json(True, data={"memories": memories, "count": len(memories)})

    except Exception as e:
        # Table might not exist yet
        if "Episodic" in str(e) and (
            "not exist" in str(e).lower() or "cannot" in str(e).lower()
        ):
            output_json(True, data={"memories": [], "count": 0})
        else:
            output_error(f"Query failed: {e}")


def cmd_search(args):
    """Search memories by keyword."""
    if not apply_monkeypatch():
        output_error("Neither kuzu nor LadybugDB is installed")
        return

    conn, error = get_db_connection(args.db_path, args.database)
    if not conn:
        output_error(error or "Failed to connect to database")
        return

    try:
        limit = args.limit or 20
        search_query = args.query.lower()
        group_id = resolve_group_id(args)

        # Optionally scope to a single project's group_id
        group_clause = "e.group_id = $group_id\n              AND " if group_id else ""

        # Search in episodic nodes using CONTAINS with parameterized query
        query = f"""
            MATCH (e:Episodic)
            WHERE {group_clause}(toLower(e.name) CONTAINS $search_query
               OR toLower(e.content) CONTAINS $search_query
               OR toLower(e.source_description) CONTAINS $search_query)
            RETURN e.uuid as uuid, e.name as name, e.created_at as created_at,
                   e.content as content, e.source_description as description,
                   e.group_id as group_id
            ORDER BY e.created_at DESC
            LIMIT $limit
        """

        parameters = {"search_query": search_query, "limit": limit}
        if group_id:
            parameters["group_id"] = group_id
        result = conn.execute(query, parameters=parameters)

        # Process results without pandas
        memories = []
        while result.has_next():
            row = result.get_next()
            # Row order: uuid, name, created_at, content, description, group_id
            uuid_val = serialize_value(row[0]) if len(row) > 0 else None
            name_val = serialize_value(row[1]) if len(row) > 1 else ""
            created_at_val = serialize_value(row[2]) if len(row) > 2 else None
            content_val = serialize_value(row[3]) if len(row) > 3 else ""
            description_val = serialize_value(row[4]) if len(row) > 4 else ""
            group_id_val = serialize_value(row[5]) if len(row) > 5 else ""

            memory = {
                "id": uuid_val or name_val or "unknown",
                "name": name_val or "",
                "type": infer_episode_type(name_val or "", content_val or ""),
                "timestamp": created_at_val or datetime.now().isoformat(),
                "content": content_val or description_val or name_val or "",
                "description": description_val or "",
                "group_id": group_id_val or "",
                "score": 1.0,  # Keyword match score
            }

            session_num = extract_session_number(name_val or "")
            if session_num:
                memory["session_number"] = session_num

            memories.append(memory)

        output_json(
            True,
            data={"memories": memories, "count": len(memories), "query": args.query},
        )

    except Exception as e:
        if "Episodic" in str(e) and (
            "not exist" in str(e).lower() or "cannot" in str(e).lower()
        ):
            output_json(True, data={"memories": [], "count": 0, "query": args.query})
        else:
            output_error(f"Search failed: {e}")


def cmd_semantic_search(args):
    """
    Perform semantic vector search using Graphiti embeddings.

    Falls back to keyword search if:
    - Embedder provider not configured
    - Graphiti initialization fails
    - Search fails for any reason
    """
    # Check if embedder is configured via environment
    embedder_provider = os.environ.get("GRAPHITI_EMBEDDER_PROVIDER", "").lower()

    if not embedder_provider:
        # No embedder configured, fall back to keyword search
        return cmd_search(args)

    # Try semantic search
    try:
        result = asyncio.run(_async_semantic_search(args))
        if result.get("success"):
            output_json(True, data=result.get("data"))
        else:
            # Semantic search failed, fall back to keyword search
            return cmd_search(args)
    except Exception as e:
        # Any error, fall back to keyword search
        sys.stderr.write(f"Semantic search failed, falling back to keyword: {e}\n")
        return cmd_search(args)


async def _async_semantic_search(args):
    """Async implementation of semantic search using GraphitiClient."""
    if not apply_monkeypatch():
        return {"success": False, "error": "LadybugDB not installed"}

    try:
        # Add auto-claude to path for imports
        auto_claude_dir = Path(__file__).parent
        if str(auto_claude_dir) not in sys.path:
            sys.path.insert(0, str(auto_claude_dir))

        # Import Graphiti components
        from integrations.graphiti.config import GraphitiConfig
        from integrations.graphiti.queries_pkg.client import GraphitiClient

        # Create config from environment
        config = GraphitiConfig.from_env()

        # Override database location from CLI args
        # Note: We only override db_path/database for CLI-specified locations.
        # The config.enabled flag is respected - if the user has disabled memory,
        # this CLI tool should not be used. The caller (main()) routes to this
        # function only when semantic-search command is explicitly requested.
        config.db_path = args.db_path
        config.database = args.database

        # Validate embedder configuration using public API
        validation_errors = config.get_validation_errors()
        if validation_errors:
            return {
                "success": False,
                "error": f"Embedder provider not properly configured: {'; '.join(validation_errors)}",
            }

        # Initialize client
        client = GraphitiClient(config)
        initialized = await client.initialize()

        if not initialized:
            return {"success": False, "error": "Failed to initialize Graphiti client"}

        try:
            # Perform semantic search using Graphiti
            limit = args.limit or 20
            search_query = args.query
            group_id = resolve_group_id(args)

            # Use Graphiti's search method, optionally scoped to one project
            search_kwargs = {"query": search_query, "num_results": limit}
            if group_id:
                search_kwargs["group_ids"] = [group_id]
            search_results = await client.graphiti.search(**search_kwargs)

            # Transform results to our format
            memories = []
            for result in search_results:
                # Handle both edge and episode results
                if hasattr(result, "fact"):
                    # Edge result (relationship)
                    memory = {
                        "id": getattr(result, "uuid", "unknown"),
                        "name": result.fact[:100] if result.fact else "",
                        "type": "session_insight",
                        "timestamp": getattr(
                            result, "created_at", datetime.now().isoformat()
                        ),
                        "content": result.fact or "",
                        "score": getattr(result, "score", 1.0),
                    }
                elif hasattr(result, "content"):
                    # Episode result
                    memory = {
                        "id": getattr(result, "uuid", "unknown"),
                        "name": getattr(result, "name", "")[:100],
                        "type": infer_episode_type(
                            getattr(result, "name", ""), getattr(result, "content", "")
                        ),
                        "timestamp": getattr(
                            result, "created_at", datetime.now().isoformat()
                        ),
                        "content": result.content or "",
                        "score": getattr(result, "score", 1.0),
                    }
                else:
                    # Generic result
                    memory = {
                        "id": str(getattr(result, "uuid", "unknown")),
                        "name": str(result)[:100],
                        "type": "session_insight",
                        "timestamp": datetime.now().isoformat(),
                        "content": str(result),
                        "score": 1.0,
                    }

                session_num = extract_session_number(memory.get("name", ""))
                if session_num:
                    memory["session_number"] = session_num

                memories.append(memory)

            return {
                "success": True,
                "data": {
                    "memories": memories,
                    "count": len(memories),
                    "query": search_query,
                    "search_type": "semantic",
                    "embedder": config.embedder_provider,
                },
            }

        finally:
            await client.close()

    except ImportError as e:
        return {"success": False, "error": f"Missing dependencies: {e}"}
    except Exception as e:
        return {"success": False, "error": f"Semantic search failed: {e}"}


def cmd_get_entities(args):
    """Get entity memories (patterns, gotchas, etc.) from the database."""
    if not apply_monkeypatch():
        output_error("Neither kuzu nor LadybugDB is installed")
        return

    conn, error = get_db_connection(args.db_path, args.database)
    if not conn:
        output_error(error or "Failed to connect to database")
        return

    try:
        limit = args.limit or 20
        group_id = resolve_group_id(args)

        # Optionally scope to a single project's group_id
        where_clause = "WHERE e.group_id = $group_id\n            " if group_id else ""

        # Query entity nodes with parameterized query
        query = f"""
            MATCH (e:Entity)
            {where_clause}RETURN e.uuid as uuid, e.name as name, e.summary as summary,
                   e.created_at as created_at
            ORDER BY e.created_at DESC
            LIMIT $limit
        """

        parameters = {"limit": limit}
        if group_id:
            parameters["group_id"] = group_id
        result = conn.execute(query, parameters=parameters)

        # Process results without pandas
        entities = []
        while result.has_next():
            row = result.get_next()
            # Row order: uuid, name, summary, created_at
            uuid_val = serialize_value(row[0]) if len(row) > 0 else None
            name_val = serialize_value(row[1]) if len(row) > 1 else ""
            summary_val = serialize_value(row[2]) if len(row) > 2 else ""
            created_at_val = serialize_value(row[3]) if len(row) > 3 else None

            if not summary_val:
                continue

            entity = {
                "id": uuid_val or name_val or "unknown",
                "name": name_val or "",
                "type": infer_entity_type(name_val or ""),
                "timestamp": created_at_val or datetime.now().isoformat(),
                "content": summary_val or "",
            }
            entities.append(entity)

        output_json(True, data={"entities": entities, "count": len(entities)})

    except Exception as e:
        if "Entity" in str(e) and (
            "not exist" in str(e).lower() or "cannot" in str(e).lower()
        ):
            output_json(True, data={"entities": [], "count": 0})
        else:
            output_error(f"Query failed: {e}")


def cmd_get_relationships(args):
    """Get entity-to-entity relationships from the reified graph.

    Lists relationships stored as reified RelatesToNode_ nodes connecting two
    Entity nodes: (a:Entity)-[:RELATES_TO]->(r:RelatesToNode_)-[:RELATES_TO]->(b:Entity).

    Gracefully returns an empty list if the RelatesToNode_/Entity tables do not
    exist yet (e.g. a fresh or missing database).
    """
    if not apply_monkeypatch():
        output_error("Neither kuzu nor LadybugDB is installed")
        return

    conn, error = get_db_connection(args.db_path, args.database)
    if not conn:
        # Database missing or not connectable yet -> no relationships to return
        output_json(True, data={"relationships": [], "count": 0})
        return

    try:
        limit = args.limit or 20
        group_id = resolve_group_id(args)

        # Optionally scope to a single project's group_id
        where_clause = "WHERE r.group_id = $group_id\n            " if group_id else ""

        # Query reified relationship nodes with parameterized query
        query = f"""
            MATCH (a:Entity)-[:RELATES_TO]->(r:RelatesToNode_)-[:RELATES_TO]->(b:Entity)
            {where_clause}RETURN a.name as source, b.name as target, r.fact as fact,
                   r.uuid as uuid, r.created_at as created_at
            ORDER BY r.created_at DESC
            LIMIT $limit
        """

        parameters = {"limit": limit}
        if group_id:
            parameters["group_id"] = group_id
        result = conn.execute(query, parameters=parameters)

        # Process results without pandas
        relationships = []
        while result.has_next():
            row = result.get_next()
            # Row order: source, target, fact, uuid, created_at
            source_val = serialize_value(row[0]) if len(row) > 0 else ""
            target_val = serialize_value(row[1]) if len(row) > 1 else ""
            fact_val = serialize_value(row[2]) if len(row) > 2 else ""
            uuid_val = serialize_value(row[3]) if len(row) > 3 else None
            created_at_val = serialize_value(row[4]) if len(row) > 4 else None

            relationship = {
                "id": uuid_val or "unknown",
                "source": source_val or "",
                "target": target_val or "",
                "fact": fact_val or "",
                "timestamp": created_at_val or datetime.now().isoformat(),
            }
            relationships.append(relationship)

        output_json(
            True, data={"relationships": relationships, "count": len(relationships)}
        )

    except Exception as e:
        # Tables might not exist yet
        if ("RelatesToNode_" in str(e) or "Entity" in str(e)) and (
            "not exist" in str(e).lower() or "cannot" in str(e).lower()
        ):
            output_json(True, data={"relationships": [], "count": 0})
        else:
            output_error(f"Query failed: {e}")


def cmd_add_episode(args):
    """
    Add a new episode to the memory database.

    This is called from the Electron main process to save PR review insights,
    patterns, gotchas, and other memories directly to the LadybugDB database.

    Args:
        args.db_path: Path to database directory
        args.database: Database name
        args.name: Episode name/title
        args.content: Episode content (JSON string)
        args.episode_type: Type of episode (session_insight, pattern, gotcha, task_outcome, pr_review)
        args.group_id: Optional group ID for namespacing
    """
    if not apply_monkeypatch():
        output_error("Neither kuzu nor LadybugDB is installed")
        return

    try:
        import uuid as uuid_module

        try:
            import kuzu
        except ImportError:
            import real_ladybug as kuzu

        # Parse content from JSON if provided
        content = args.content
        if content:
            try:
                # Try to parse as JSON to validate
                parsed = json.loads(content)
                # Re-serialize to ensure consistent formatting
                content = json.dumps(parsed)
            except json.JSONDecodeError:
                # If not valid JSON, use as-is
                pass

        # Generate unique ID
        episode_uuid = str(uuid_module.uuid4())
        created_at = datetime.now().isoformat()

        # Get database path - create directory if needed
        full_path = Path(args.db_path) / args.database
        if not full_path.exists():
            # For new databases, create the parent directory
            Path(args.db_path).mkdir(parents=True, exist_ok=True)

        # Open database (creates it if it doesn't exist)
        db = kuzu.Database(str(full_path))
        conn = kuzu.Connection(db)

        # Always try to create the Episodic table if it doesn't exist
        # This handles both new databases and existing databases without the table
        try:
            conn.execute("""
                CREATE NODE TABLE IF NOT EXISTS Episodic (
                    uuid STRING PRIMARY KEY,
                    name STRING,
                    content STRING,
                    source_description STRING,
                    group_id STRING,
                    created_at STRING
                )
            """)
        except Exception as schema_err:
            # Table might already exist with different schema - that's ok
            # The insert will fail if schema is incompatible
            sys.stderr.write(f"Schema creation note: {schema_err}\n")

        # Insert the episode
        try:
            insert_query = """
                CREATE (e:Episodic {
                    uuid: $uuid,
                    name: $name,
                    content: $content,
                    source_description: $description,
                    group_id: $group_id,
                    created_at: $created_at
                })
            """
            conn.execute(
                insert_query,
                parameters={
                    "uuid": episode_uuid,
                    "name": args.name,
                    "content": content,
                    "description": f"[{args.episode_type}] {args.name}",
                    "group_id": args.group_id or "",
                    "created_at": created_at,
                },
            )

            output_json(
                True,
                data={
                    "id": episode_uuid,
                    "name": args.name,
                    "type": args.episode_type,
                    "timestamp": created_at,
                },
            )

        except Exception as e:
            output_error(f"Failed to insert episode: {e}")

    except Exception as e:
        output_error(f"Failed to add episode: {e}")


def cmd_delete_memory(args):
    """
    Delete a single memory node (episodic or entity) by uuid.

    Issues a parameterized, single-node DETACH DELETE against the matching node
    so relationships are cleaned up alongside it. Follows the parameterized /
    single-node-match conventions in security/database_validators.py.

    Args:
        args.db_path: Path to database directory
        args.database: Database name
        args.uuid: UUID of the node to delete
        args.kind: Node kind ("episodic" or "entity")

    Guards against missing databases and tables, always reporting JSON rather
    than crashing.
    """
    if not apply_monkeypatch():
        output_error("Neither kuzu nor LadybugDB is installed")
        return

    kind = (args.kind or "").lower()
    label = {"episodic": "Episodic", "entity": "Entity"}.get(kind)
    if not label:
        output_error(f"Invalid --kind '{args.kind}' (expected 'episodic' or 'entity')")
        return

    # Missing database → nothing to delete, but not an error
    full_path = Path(args.db_path) / args.database
    if not full_path.exists():
        output_json(True, data={"deleted": False, "id": args.uuid})
        return

    conn, error = get_db_connection(args.db_path, args.database)
    if not conn:
        output_error(error or "Failed to connect to database")
        return

    try:
        # Parameterized, single-node match then DETACH DELETE to remove the node
        # together with any attached relationships.
        query = f"MATCH (e:{label} {{uuid: $uuid}}) DETACH DELETE e"
        conn.execute(query, parameters={"uuid": args.uuid})
        output_json(True, data={"deleted": True, "id": args.uuid})

    except Exception as e:
        # Table might not exist yet → treat as nothing to delete
        if label in str(e) and (
            "not exist" in str(e).lower() or "cannot" in str(e).lower()
        ):
            output_json(True, data={"deleted": False, "id": args.uuid})
        else:
            output_error(f"Delete failed: {e}")


def cmd_update_memory(args):
    """
    Update a single memory node (episodic or entity) by uuid.

    For episodic nodes the new value targets the ``content`` field; for entity
    nodes it targets the ``summary`` field. An optional ``--name`` updates the
    node name for either kind. Uses a parameterized, single-node MATCH then SET
    following the conventions in security/database_validators.py.

    Args:
        args.db_path: Path to database directory
        args.database: Database name
        args.uuid: UUID of the node to update
        args.kind: Node kind ("episodic" or "entity")
        args.content: New content (episodic only)
        args.summary: New summary (entity only)
        args.name: Optional new name

    Returns the updated record {id, name, type, timestamp, content}. Guards
    against missing databases and tables, always reporting JSON rather than
    crashing.
    """
    if not apply_monkeypatch():
        output_error("Neither kuzu nor LadybugDB is installed")
        return

    kind = (args.kind or "").lower()
    label = {"episodic": "Episodic", "entity": "Entity"}.get(kind)
    if not label:
        output_error(f"Invalid --kind '{args.kind}' (expected 'episodic' or 'entity')")
        return

    # Resolve the value field for this kind and build a parameterized SET clause.
    value_field = "content" if kind == "episodic" else "summary"
    new_value = getattr(args, value_field, None)

    set_parts = []
    parameters = {"uuid": args.uuid}
    if new_value is not None:
        set_parts.append(f"e.{value_field} = ${value_field}")
        parameters[value_field] = new_value
    if getattr(args, "name", None) is not None:
        set_parts.append("e.name = $name")
        parameters["name"] = args.name

    if not set_parts:
        output_error(
            "Nothing to update (provide --content/--summary or --name)"
        )
        return

    # Missing database → nothing to update, but not an error
    full_path = Path(args.db_path) / args.database
    if not full_path.exists():
        output_json(True, data={"updated": False, "id": args.uuid})
        return

    conn, error = get_db_connection(args.db_path, args.database)
    if not conn:
        output_error(error or "Failed to connect to database")
        return

    try:
        # Parameterized, single-node match then SET the targeted field(s), then
        # return the updated record so the caller can refresh its view.
        query = f"""
            MATCH (e:{label} {{uuid: $uuid}})
            SET {", ".join(set_parts)}
            RETURN e.uuid as uuid, e.name as name, e.created_at as created_at,
                   e.{value_field} as content
        """
        result = conn.execute(query, parameters=parameters)

        row = result.get_next() if result.has_next() else None
        if row is None:
            # No node matched the uuid → nothing updated
            output_json(True, data={"updated": False, "id": args.uuid})
            return

        # Row order: uuid, name, created_at, content
        uuid_val = serialize_value(row[0]) if len(row) > 0 else None
        name_val = serialize_value(row[1]) if len(row) > 1 else ""
        created_at_val = serialize_value(row[2]) if len(row) > 2 else None
        content_val = serialize_value(row[3]) if len(row) > 3 else ""

        record = {
            "id": uuid_val or args.uuid,
            "name": name_val or "",
            "type": (
                infer_episode_type(name_val or "", content_val or "")
                if kind == "episodic"
                else infer_entity_type(name_val or "")
            ),
            "timestamp": created_at_val or datetime.now().isoformat(),
            "content": content_val or "",
        }
        output_json(True, data={"updated": True, "record": record})

    except Exception as e:
        # Table might not exist yet → treat as nothing to update
        if label in str(e) and (
            "not exist" in str(e).lower() or "cannot" in str(e).lower()
        ):
            output_json(True, data={"updated": False, "id": args.uuid})
        else:
            output_error(f"Update failed: {e}")


def infer_episode_type(name: str, content: str = "") -> str:
    """Infer the episode type from its name and content."""
    name_lower = (name or "").lower()
    content_lower = (content or "").lower()

    if "session_" in name_lower or '"type": "session_insight"' in content_lower:
        return "session_insight"
    if "pattern" in name_lower or '"type": "pattern"' in content_lower:
        return "pattern"
    if "gotcha" in name_lower or '"type": "gotcha"' in content_lower:
        return "gotcha"
    if "codebase" in name_lower or '"type": "codebase_discovery"' in content_lower:
        return "codebase_discovery"
    if "task_outcome" in name_lower or '"type": "task_outcome"' in content_lower:
        return "task_outcome"

    return "session_insight"


def infer_entity_type(name: str) -> str:
    """Infer the entity type from its name."""
    name_lower = (name or "").lower()

    if "pattern" in name_lower:
        return "pattern"
    if "gotcha" in name_lower:
        return "gotcha"
    if "file_insight" in name_lower or "codebase" in name_lower:
        return "codebase_discovery"

    return "session_insight"


def extract_session_number(name: str) -> int | None:
    """Extract session number from episode name."""
    match = re.search(r"session[_-]?(\d+)", name or "", re.IGNORECASE)
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            pass
    return None


def main():
    parser = argparse.ArgumentParser(
        description="Query LadybugDB memory database for auto-claude-ui"
    )
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # get-status command
    status_parser = subparsers.add_parser("get-status", help="Get database status")
    status_parser.add_argument("db_path", help="Path to database directory")
    status_parser.add_argument("database", help="Database name")

    def add_scope_args(subparser):
        """Add optional project-scoping args (backward compatible when omitted)."""
        subparser.add_argument(
            "--project-dir",
            dest="project_dir",
            default=None,
            help="Scope results to this project's memory (computes group_id)",
        )
        subparser.add_argument(
            "--group-id",
            dest="group_id",
            default=None,
            help="Scope results to an explicit group_id (overrides --project-dir)",
        )

    # get-memories command
    memories_parser = subparsers.add_parser(
        "get-memories", help="Get episodic memories"
    )
    memories_parser.add_argument("db_path", help="Path to database directory")
    memories_parser.add_argument("database", help="Database name")
    memories_parser.add_argument(
        "--limit", type=int, default=20, help="Maximum results"
    )
    add_scope_args(memories_parser)

    # search command
    search_parser = subparsers.add_parser("search", help="Search memories")
    search_parser.add_argument("db_path", help="Path to database directory")
    search_parser.add_argument("database", help="Database name")
    search_parser.add_argument("query", help="Search query")
    search_parser.add_argument("--limit", type=int, default=20, help="Maximum results")
    add_scope_args(search_parser)

    # semantic-search command
    semantic_parser = subparsers.add_parser(
        "semantic-search",
        help="Semantic vector search (falls back to keyword if embedder not configured)",
    )
    semantic_parser.add_argument("db_path", help="Path to database directory")
    semantic_parser.add_argument("database", help="Database name")
    semantic_parser.add_argument("query", help="Search query")
    semantic_parser.add_argument(
        "--limit", type=int, default=20, help="Maximum results"
    )
    add_scope_args(semantic_parser)

    # get-entities command
    entities_parser = subparsers.add_parser("get-entities", help="Get entity memories")
    entities_parser.add_argument("db_path", help="Path to database directory")
    entities_parser.add_argument("database", help="Database name")
    entities_parser.add_argument(
        "--limit", type=int, default=20, help="Maximum results"
    )
    add_scope_args(entities_parser)

    # get-relationships command
    relationships_parser = subparsers.add_parser(
        "get-relationships", help="Get entity-to-entity relationships"
    )
    relationships_parser.add_argument("db_path", help="Path to database directory")
    relationships_parser.add_argument("database", help="Database name")
    relationships_parser.add_argument(
        "--limit", type=int, default=20, help="Maximum results"
    )
    add_scope_args(relationships_parser)

    # add-episode command (for saving memories from Electron app)
    add_parser = subparsers.add_parser(
        "add-episode",
        help="Add an episode to the memory database (called from Electron)",
    )
    add_parser.add_argument("db_path", help="Path to database directory")
    add_parser.add_argument("database", help="Database name")
    add_parser.add_argument("--name", required=True, help="Episode name/title")
    add_parser.add_argument(
        "--content", required=True, help="Episode content (JSON string)"
    )
    add_parser.add_argument(
        "--type",
        dest="episode_type",
        default="session_insight",
        help="Episode type (session_insight, pattern, gotcha, task_outcome, pr_review)",
    )
    add_parser.add_argument(
        "--group-id", dest="group_id", help="Optional group ID for namespacing"
    )

    # delete-memory command (for removing memories from the Electron app)
    delete_parser = subparsers.add_parser(
        "delete-memory",
        help="Delete a memory node (episodic or entity) by uuid",
    )
    delete_parser.add_argument("db_path", help="Path to database directory")
    delete_parser.add_argument("database", help="Database name")
    delete_parser.add_argument(
        "--uuid", required=True, help="UUID of the node to delete"
    )
    delete_parser.add_argument(
        "--kind",
        required=True,
        choices=["episodic", "entity"],
        help="Node kind to delete (episodic or entity)",
    )

    # update-memory command (for editing memories from the Electron app)
    update_parser = subparsers.add_parser(
        "update-memory",
        help="Update a memory node (episodic or entity) by uuid",
    )
    update_parser.add_argument("db_path", help="Path to database directory")
    update_parser.add_argument("database", help="Database name")
    update_parser.add_argument(
        "--uuid", required=True, help="UUID of the node to update"
    )
    update_parser.add_argument(
        "--kind",
        required=True,
        choices=["episodic", "entity"],
        help="Node kind to update (episodic or entity)",
    )
    update_parser.add_argument(
        "--content", default=None, help="New content (episodic nodes)"
    )
    update_parser.add_argument(
        "--summary", default=None, help="New summary (entity nodes)"
    )
    update_parser.add_argument(
        "--name", default=None, help="Optional new name for the node"
    )

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        output_error("No command specified")
        return

    # Route to command handler
    commands = {
        "get-status": cmd_get_status,
        "get-memories": cmd_get_memories,
        "search": cmd_search,
        "semantic-search": cmd_semantic_search,
        "get-entities": cmd_get_entities,
        "get-relationships": cmd_get_relationships,
        "add-episode": cmd_add_episode,
        "delete-memory": cmd_delete_memory,
        "update-memory": cmd_update_memory,
    }

    handler = commands.get(args.command)
    if handler:
        handler(args)
    else:
        output_error(f"Unknown command: {args.command}")


if __name__ == "__main__":
    main()
